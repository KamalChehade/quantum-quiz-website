import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { io, Socket } from "socket.io-client";

interface Participant {
  id: number;
  name: string;
  phone: string;
  score: number;
  gameSessionId: number;
  joinedAt: string;
}

interface Question {
  id: number;
  text: string;
  choices: { key: string; text: string }[];
  order: number;
}

interface QuestionLeaderboardRow {
  id?: number;
  questionId?: number;
  participantId?: number;
  rank: number | null;
  scoreForQuestion: number;
  isCorrect: boolean;
  answeredAt?: string;
  participant?: Participant;
  correctAnswer?: {
    key: string;
    text: string;
  } | null;
}

interface GameLeaderboardEntry {
  participantId?: number;
  participant?: Participant;
  totalScore: number;
  totalQuestionsAnswered?: number;
  correctAnswersCount?: number;
  accuracyPercent?: number;
  fastestAnswerSeconds?: number;
  questionsCorrect?: number[];
  rank?: number | null;
}

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  participant: Participant | null;
  currentQuestion: Question | null;
  questionLeaderboard: QuestionLeaderboardRow[];
  gameLeaderboard: GameLeaderboardEntry[];
  lobbyParticipants: Participant[];
  gameStatus: "idle" | "active" | "ended";
  joinQuiz: (name: string, phone: string) => Promise<any>;
  submitAnswer: (questionId: number, selectedAnswer: string) => Promise<any>;
  connectAsAdmin: (token: string) => void;
  adminStartGame: () => Promise<any>;
  adminStartQuestion: (questionId: number) => void;
  adminEndQuestion: (questionId: number) => void;
  // local setters for UI refresh (used by admin UI after destructive actions)
  setLobbyParticipantsLocal: (p: Participant[]) => void;
  setGameStatusLocal: (s: "idle" | "active" | "ended") => void;
  setGameLeaderboardLocal: (g: GameLeaderboardEntry[]) => void;
  setQuestionLeaderboardLocal: (q: QuestionLeaderboardRow[]) => void;
  setParticipantLocal: (p: Participant | null) => void;
  // player-specific resume state
  myAnswerSubmitted: boolean;
  myAnswerForQuestionId: number | null;
  mySelectedAnswer: string | null;
  adminOnline: boolean;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within SocketProvider");
  }
  return context;
};

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [questionLeaderboard, setQuestionLeaderboard] = useState<
    QuestionLeaderboardRow[]
  >([]);
  const [gameLeaderboard, setGameLeaderboard] = useState<
    GameLeaderboardEntry[]
  >([]);
  const [lobbyParticipants, setLobbyParticipants] = useState<Participant[]>([]);
  const [gameStatus, setGameStatus] = useState<"idle" | "active" | "ended">(
    "idle"
  );
  const [adminOnline, setAdminOnline] = useState(false);
  const [myAnswerSubmitted, setMyAnswerSubmitted] = useState(false);
  const [myAnswerForQuestionId, setMyAnswerForQuestionId] = useState<
    number | null
  >(null);
  const [mySelectedAnswer, setMySelectedAnswer] = useState<string | null>(null);
  // track whether the server has acknowledged that this socket joined the quiz room
  const [isServerJoined, setIsServerJoined] = useState(false);
  // Track the latest active question id and last event type to dedupe racey events
  const activeQuestionIdRef = useRef<number | null>(null);
  const lastQuestionEventTypeRef = useRef<"started" | "resume" | null>(null);

  const initializeSocket = (token?: string) => {
    const normalizeQuestion = (q: any): Question | null => {
      if (!q) return null;
      try {
        // extract text and id with several fallbacks
        const id = q.id ?? q.questionId ?? q.question_id ?? null;
        const text = q.text ?? q.question_text ?? q.prompt ?? "";
        const order = q.order ?? q.orderNumber ?? q.questionOrder ?? 0;

        let rawChoices: any = q.choices ?? q.options ?? q.answers ?? null;
        // if choices is a JSON string, try parse
        if (typeof rawChoices === "string") {
          try {
            rawChoices = JSON.parse(rawChoices);
          } catch (e) {
            // fallback: split by newlines
            rawChoices = rawChoices
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean);
          }
        }

        let choices: { key: string; text: string }[] = [];
        if (Array.isArray(rawChoices)) {
          if (rawChoices.length > 0 && typeof rawChoices[0] === "string") {
            // array of strings -> label with letters A,B,C...
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            choices = rawChoices.map((c: string, i: number) => ({
              key: letters[i] ?? String(i + 1),
              text: String(c),
            }));
          } else {
            // array of objects -> normalize fields
            choices = rawChoices.map((item: any, i: number) => ({
              key: item.key ?? item.id ?? item.label ?? String(i + 1),
              text: item.text ?? item.label ?? item.answer ?? String(item),
            }));
          }
        } else if (rawChoices && typeof rawChoices === "object") {
          // object map like { A: 'option1', B: 'option2' }
          choices = Object.keys(rawChoices).map((k) => ({
            key: k,
            text: String(rawChoices[k]),
          }));
        } else {
          // no choices provided, leave empty
          choices = [];
        }

        return {
          id: typeof id === "number" ? id : id ? Number(id) : 0,
          text: String(text ?? ""),
          choices,
          order: typeof order === "number" ? order : order ? Number(order) : 0,
        };
      } catch (err) {
        return null;
      }
    };
    // Runtime fallback: some deployed clients or cached bundles may still try to call
    // /socket.io/ at the origin. As a safety-net, rewrite outgoing XHR/fetch
    // requests that target '/socket.io' to the correct '/qa-api/socket.io' path
    // (only for same-origin requests). This is defensive and helps when a cached
    // bundle or service worker triggers the old endpoint.
    try {
      if (
        typeof window !== "undefined" &&
        !(window as any).__socketPathPatched
      ) {
        (window as any).__socketPathPatched = true;
        const targetPath =
          (import.meta.env.VITE_SOCKET_PATH as string | undefined) ||
          "/qa-api/socket.io";
        // Patch XMLHttpRequest.open
        const origOpen = XMLHttpRequest.prototype.open;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        XMLHttpRequest.prototype.open = function (
          method: string,
          url: string | URL
        ) {
          try {
            const str = typeof url === "string" ? url : String(url);
            // only rewrite same-origin and root /socket.io requests
            if (str.startsWith("/") && str.indexOf("/socket.io") === 0) {
              const newUrl = targetPath + str.slice("/socket.io".length);
              // @ts-ignore
              return origOpen.apply(this, [method, newUrl]);
            }
          } catch (e) {
            // ignore
          }
          // @ts-ignore
          return origOpen.apply(this, arguments as any);
        };

        // Patch fetch to rewrite requests to /socket.io
        if (window.fetch) {
          const origFetch = window.fetch.bind(window);
          // widen the type to accept URL | RequestInfo
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore - adapt runtime types for patching
          window.fetch = (input: URL | RequestInfo, init?: RequestInit) => {
            try {
              const url =
                typeof input === "string"
                  ? input
                  : input instanceof Request
                  ? input.url
                  : input instanceof URL
                  ? input.href
                  : "";
              if (
                url &&
                url.startsWith("/") &&
                url.indexOf("/socket.io") === 0
              ) {
                const newUrl =
                  (import.meta.env.VITE_SOCKET_PATH as string | undefined) ||
                  "/qa-api/socket.io";
                return origFetch(newUrl, init);
              }
            } catch (e) {
              // ignore
            }
            // @ts-ignore
            return origFetch(input, init);
          };
        }
        console.debug(
          "[Socket] runtime rewrite installed to map /socket.io ->",
          targetPath
        );
      }
    } catch (e) {
      /* ignore patch errors */
    }
    const socketBase =
      (import.meta.env.VITE_SOCKET_URL as string | undefined) ||
      (import.meta.env.VITE_API_URL as string | undefined) ||
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
      window.location.origin ||
      "http://localhost:3000";
    const socketPath =
      (import.meta.env.VITE_SOCKET_PATH as string | undefined) ||
      "/qa-api/socket.io";

    const socketOptions: any = {
      path: socketPath,
      transports: ["websocket", "polling"],
    };
    if (token) {
      // ensure token is sent in Bearer form so server can parse Authorization style tokens
      const outToken =
        typeof token === "string" && token.startsWith("Bearer ")
          ? token
          : `Bearer ${token}`;
      socketOptions.auth = { token: outToken };
    }

    console.debug("[Socket] connecting", {
      socketBase,
      socketPath,
      socketOptions,
    });
    try {
      console.debug("[Socket] connect to", socketBase + socketPath);
    } catch (e) {
      /* ignore */
    }
    // IMPORTANT: pass the origin (socketBase) to io() and let the `path` option handle the socket path.
    // Passing the full URL including the socket path as the first arg causes socket.io-client to treat
    // the path segment as a namespace (which triggers "Invalid namespace").
    const newSocket = io(socketBase, socketOptions);

    newSocket.on("connect", () => {
      setIsConnected(true);
      try {
        console.debug("[Socket] connected", {
          id: newSocket.id,
          url: socketBase + socketPath,
        });
      } catch (e) {
        console.debug("[Socket] connected (no details)");
      }
      // probe server for admin presence (optional server support)
      try {
        // server may respond to 'is_admin_present' with ack({ present: boolean })
        // or simply ack(true/false). Also some server/client combinations may
        // deliver the ack as a single argument or (err, resp). Be tolerant.
        newSocket
          .timeout(2000)
          .emit("is_admin_present", undefined, (...cbArgs: any[]) => {
            try {
              // cbArgs may be [resp] or [err, resp]
              let resp =
                cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
              // resp might be a bare boolean or an object { present }
              const present =
                resp?.present ?? (typeof resp === "boolean" ? resp : false);
              setAdminOnline(Boolean(present));
            } catch (e) {
              /* ignore */
            }
          });
      } catch (e) {
        // ignore if server doesn't support probing
      }

      // attempt to auto-join as a player if we have saved participant info
      try {
        const raw = localStorage.getItem("participant");
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && (saved.name || saved.phone)) {
            // use ack-style emit so server can deny join when no admin is connected
            newSocket.emit(
              "join_quiz",
              { name: saved.name, phone: saved.phone },
              (ack: any) => {
                try {
                  const ok = ack?.ok ?? true;
                  if (ok) {
                    if (ack?.participant) {
                      setParticipant(ack.participant);
                      localStorage.setItem(
                        "participant",
                        JSON.stringify(ack.participant)
                      );
                    }
                    setIsServerJoined(true);
                  }
                } catch (e) {
                  /* ignore ack handling errors */
                }
              }
            );
          }
        } else {
          // No saved participant: treat as audience client
          try {
            newSocket.emit('audience_join');
          } catch { /* ignore */ }
          // Try to fetch the current active question for audience (server optional support)
          const handleCurrent = (resp: any) => {
            try {
              const q = resp?.question ?? resp?.currentQuestion ?? resp ?? null;
              const norm = normalizeQuestion(q);
              if (norm && norm.id) {
                activeQuestionIdRef.current = norm.id;
                lastQuestionEventTypeRef.current = 'resume';
                setCurrentQuestion(norm);
                setQuestionLeaderboard([]);
              }
            } catch { /* ignore */ }
          };
          try {
            newSocket.timeout(2000).emit('audience_get_question', undefined, (...args: any[]) => {
              const resp = args.length === 1 ? args[0] : args[1] ?? args[0];
              handleCurrent(resp);
            });
          } catch { /* ignore */ }
          try {
            newSocket.timeout(2000).emit('get_current_question', undefined, (...args: any[]) => {
              const resp = args.length === 1 ? args[0] : args[1] ?? args[0];
              handleCurrent(resp);
            });
          } catch { /* ignore */ }
        }
      } catch (err) {
        // ignore parse errors
      }
    });

    newSocket.on("connect_error", (err: any) => {
      try {
        console.error(
          "[Socket] connect_error",
          err && err.message ? err.message : err
        );
      } catch (e) {
        console.error("[Socket] connect_error");
      }
    });

    newSocket.on("connect_timeout", (timeout: any) => {
      console.error("[Socket] connect_timeout", timeout);
    });

    newSocket.on("reconnect_attempt", (attempt: number) => {
      console.debug("[Socket] reconnect_attempt", attempt);
    });

    newSocket.on("reconnecting", (attempt: number) => {
      console.debug("[Socket] reconnecting", attempt);
    });

    newSocket.on("reconnect_failed", () => {
      console.error("[Socket] reconnect_failed");
    });

    newSocket.on("disconnect", (reason: any) => {
      setIsConnected(false);
      try {
        console.debug("[Socket] disconnected", { id: newSocket.id, reason });
      } catch (e) {
        console.debug("[Socket] disconnected");
      }
      // when disconnected, admin presence is unknown
      setAdminOnline(false);
      setIsServerJoined(false);
    });

    newSocket.on("reconnect", () => {
      // on reconnect, try to rejoin using saved participant
      try {
        const raw = localStorage.getItem("participant");
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && (saved.name || saved.phone)) {
            newSocket.emit("join_quiz", {
              name: saved.name,
              phone: saved.phone,
            });
          }
        } else {
          // audience client: rejoin the session room
          try { newSocket.emit('audience_join'); } catch { /* ignore */ }
        }
      } catch (err) {
        // ignore
      }
      // also probe admin presence after reconnect
      try {
        newSocket
          .timeout(2000)
          .emit("is_admin_present", undefined, (...cbArgs: any[]) => {
            try {
              let resp =
                cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
              const present =
                resp?.present ?? (typeof resp === "boolean" ? resp : false);
              setAdminOnline(Boolean(present));
            } catch (e) {
              /* ignore */
            }
          });
      } catch (e) {
        /* ignore */
      }
    });

    newSocket.on("joined_success", ({ participant: joinedParticipant }) => {
      setParticipant(joinedParticipant);
      localStorage.setItem("participant", JSON.stringify(joinedParticipant));
      setIsServerJoined(true);
    });

    // IMPORTANT: handle resume/start with dedup to avoid race conditions

    newSocket.on("lobby_update", ({ participants }) => {
      setLobbyParticipants(participants);
    });

    newSocket.on("game_started", () => {
      setGameStatus("active");
      setCurrentQuestion(null);
      activeQuestionIdRef.current = null;
      lastQuestionEventTypeRef.current = null;
    });

    // Start of a new question; always preferred over a conflicting resume
    newSocket.on("question_started", ({ question }) => {
      const q = normalizeQuestion(question);
      const qid = q?.id ?? null;
      if (!qid) return;
      // Accept starts that change the active id or refresh the same id
      if (activeQuestionIdRef.current !== qid) {
        console.debug("[Socket] question_started -> accept", qid);
      } else {
        console.debug("[Socket] question_started -> duplicate", qid);
      }
      activeQuestionIdRef.current = qid;
      lastQuestionEventTypeRef.current = "started";
      setCurrentQuestion(q);
      setQuestionLeaderboard([]);
      setMyAnswerSubmitted(false);
      setMyAnswerForQuestionId(null);
      setMySelectedAnswer(null);
    });

    // Resume current question; accept only if it doesn't conflict with a newer start
    newSocket.on("resume_question", (payload: any) => {
      const rawQuestion = payload?.question ?? null;
      const q = normalizeQuestion(rawQuestion);
      const qid = q?.id ?? null;
      if (!qid) return;
      // If a start already set a different active id, ignore this resume as stale
      if (
        activeQuestionIdRef.current !== null &&
        activeQuestionIdRef.current !== qid &&
        lastQuestionEventTypeRef.current === "started"
      ) {
        console.debug(
          "[Socket] resume_question -> stale; ignoring",
          qid,
          "active:",
          activeQuestionIdRef.current
        );
        return;
      }
      // Otherwise accept resume
      console.debug("[Socket] resume_question -> accept", qid);
      activeQuestionIdRef.current = qid;
      lastQuestionEventTypeRef.current = "resume";
      setCurrentQuestion(q);
      const answered = !!(
        payload?.hasAnswered ||
        payload?.answeredAt ||
        payload?.answered_at
      );
      if (answered) {
        setMyAnswerSubmitted(true);
        setMyAnswerForQuestionId(qid);
        setMySelectedAnswer(
          payload?.selectedAnswer ?? payload?.selected_answer ?? null
        );
      } else {
        setMyAnswerSubmitted(false);
        setMyAnswerForQuestionId(null);
        setMySelectedAnswer(null);
      }
    });

    // Support server's combined resume event name: question_resumed
    newSocket.on("question_resumed", (payload: any) => {
      const rawQuestion = payload?.question ?? null;
      const q = normalizeQuestion(rawQuestion);
      const qid = q?.id ?? payload?.questionId ?? null;
      if (!qid) return;
      // If a start already set a different active id, ignore this resume as stale
      if (
        activeQuestionIdRef.current !== null &&
        activeQuestionIdRef.current !== Number(qid) &&
        lastQuestionEventTypeRef.current === "started"
      ) {
        console.debug(
          "[Socket] question_resumed -> stale; ignoring",
          qid,
          "active:",
          activeQuestionIdRef.current
        );
        return;
      }
      // Accept resume
      console.debug("[Socket] question_resumed -> accept", qid);
      activeQuestionIdRef.current = Number(qid);
      lastQuestionEventTypeRef.current = "resume";
      setCurrentQuestion(q);
      const answered = !!(
        payload?.hasAnswered ||
        payload?.answeredAt ||
        payload?.answered_at
      );
      if (answered) {
        setMyAnswerSubmitted(true);
        setMyAnswerForQuestionId(Number(qid));
        setMySelectedAnswer(
          payload?.selectedAnswer ?? payload?.selected_answer ?? null
        );
      } else {
        setMyAnswerSubmitted(false);
        setMyAnswerForQuestionId(null);
        setMySelectedAnswer(null);
      }
      // Clear any existing per-question leaderboard on resume to focus on the active question
      setQuestionLeaderboard([]);
    });

    newSocket.on("answer_received", ({ success, isCorrect, message }) => {
      console.log("Answer received:", { success, isCorrect, message });
    });

    newSocket.on("question_leaderboard", (payload: any) => {
      // payload: { questionId?, leaderboard }
      const lb = payload?.leaderboard ?? payload ?? [];
      const qId = payload?.questionId ?? undefined;
      const mapped: QuestionLeaderboardRow[] = (lb || []).map(
        (p: any, i: number) => ({
          id: p.id ?? undefined,
          questionId: qId ?? p.questionId ?? undefined,
          participantId: p.participantId ?? p.participant?.id ?? undefined,
          rank: typeof p.rank === "number" ? p.rank : i + 1,
          scoreForQuestion: p.score ?? p.scoreForQuestion ?? p.points ?? 0,
          isCorrect: p.isCorrect ?? p.correct ?? false,
          answeredAt: p.answeredAt ?? p.answered_at ?? undefined,
          participant: p.participant
            ? p.participant
            : {
                id: p.participantId ?? i,
                name: p.name ?? p.username ?? `Participant ${i + 1}`,
                phone: "",
                score: p.totalScore ?? p.score ?? 0,
                gameSessionId: 0,
                joinedAt: "",
              },
          correctAnswer: p.correctAnswer
            ? {
                key: p.correctAnswer.key ?? "",
                text: p.correctAnswer.text ?? "",
              }
            : null,
        })
      );
      setQuestionLeaderboard(mapped);
      setCurrentQuestion(null);
      activeQuestionIdRef.current = null;
      lastQuestionEventTypeRef.current = null;
    });

    // Remove non-standard question_resumed; resume_question already handled above
    newSocket.on("admin_presence", (payload: any) => {
      try {
        const present =
          payload?.present ??
          (typeof payload === "boolean" ? payload : !!payload);
        const wasAdminOffline = !adminOnline && present; // Admin just came online

        setAdminOnline(Boolean(present));

        // If admin just came online and we have not joined the room yet, try a single reliable rejoin
        if (wasAdminOffline && !isServerJoined) {
          try {
            const raw = localStorage.getItem("participant");
            const saved = raw ? JSON.parse(raw) : participant;
            const name = saved?.name ?? participant?.name;
            const phone = saved?.phone ?? participant?.phone;
            if (name || phone) {
              newSocket.emit("join_quiz", { name, phone }, (ack: any) => {
                try {
                  const ok = ack?.ok ?? true;
                  if (ok) {
                    if (ack?.participant) {
                      setParticipant(ack.participant);
                      localStorage.setItem(
                        "participant",
                        JSON.stringify(ack.participant)
                      );
                    }
                    setIsServerJoined(true);
                  }
                } catch {
                  /* ignore */
                }
              });
            }
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        console.error("[Socket] Error in admin_presence handler:", e);
      }
    });

    newSocket.on("game_leaderboard", (payload: any) => {
      const lb = payload?.leaderboard ?? payload ?? [];
      const mapped: GameLeaderboardEntry[] = (lb || []).map(
        (p: any, i: number) => ({
          participantId: p.participantId ?? p.participant?.id ?? i,
          participant: p.participant
            ? p.participant
            : {
                id: p.participantId ?? i,
                name: p.name ?? p.username ?? `Participant ${i + 1}`,
                phone: "",
                score: p.totalScore ?? p.score ?? 0,
                gameSessionId: 0,
                joinedAt: "",
              },
          totalScore: p.totalScore ?? p.total ?? p.score ?? 0,
          totalQuestionsAnswered:
            p.totalQuestionsAnswered ?? p.answeredCount ?? undefined,
          correctAnswersCount: p.correctAnswersCount ?? p.correct ?? undefined,
          accuracyPercent: p.accuracyPercent ?? undefined,
          fastestAnswerSeconds: p.fastestAnswerSeconds ?? undefined,
          questionsCorrect: p.questionsCorrect ?? undefined,
          rank: typeof p.rank === "number" ? p.rank : i + 1,
        })
      );
      setGameLeaderboard(mapped);
      setGameStatus("ended");
      // If the game ended, clear any player session so they return to join screen
      try {
        setParticipant(null);
        localStorage.removeItem("participant");
        setMyAnswerSubmitted(false);
        setMyAnswerForQuestionId(null);
        setMySelectedAnswer(null);
      } catch (err) {
        /* ignore */
      }
    });

    setSocket(newSocket);
    return newSocket;
  };

  // On mount, hydrate participant from localStorage and auto-initialize socket so
  // players don't see the Join screen immediately after refresh.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("participant");
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && (saved.name || saved.phone || saved.id)) {
          setParticipant(saved as Participant);
          // initialize socket if not already connected; initializeSocket will auto-emit join on connect
          if (!socket) {
            initializeSocket();
          }
        }
      }
    } catch (err) {
      // ignore parse errors
    }
    // If no saved participant exists, still initialize the socket for anonymous clients
    // so they can receive admin presence broadcasts and probes. This prevents the
    // Join screen from being stuck when an admin is already connected.
    if (!socket) {
      try {
        initializeSocket();
      } catch (e) {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Optional: periodically probe admin presence without disconnecting players.
  // This complements server broadcasts and helps recover UI if a presence event was missed.
  useEffect(() => {
    if (!socket || !isConnected) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      try {
        socket
          .timeout(2000)
          .emit("is_admin_present", undefined, (...cbArgs: any[]) => {
            try {
              let resp =
                cbArgs.length === 1 ? cbArgs[0] : cbArgs[1] ?? cbArgs[0];
              const present =
                resp?.present ?? (typeof resp === "boolean" ? resp : false);
              setAdminOnline(Boolean(present));
            } catch (e) {
              /* ignore */
            }
          });
      } catch (e) {
        // ignore if server doesn't support probing
      }
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [socket, isConnected]);

  const joinQuiz = (name: string, phone: string) => {
    return new Promise<any>((resolve) => {
      const doEmit = (s: Socket | null) => {
        if (!s) return resolve({ ok: false, error: "no-socket" });
        try {
          s.emit("join_quiz", { name, phone }, (ack: any) => {
            try {
              const ok = ack?.ok ?? true;
              if (ok && ack?.participant) {
                setParticipant(ack.participant);
                localStorage.setItem(
                  "participant",
                  JSON.stringify(ack.participant)
                );
                setIsServerJoined(true);
              }
              resolve(ack ?? { ok });
            } catch (e) {
              resolve({ ok: false, error: "ack-handling-error" });
            }
          });
        } catch (err) {
          resolve({ ok: false, error: "emit-error" });
        }
      };

      if (!socket) {
        const newSocket = initializeSocket();
        // wait for connect before emitting
        newSocket.on("connect", function once() {
          newSocket.off("connect", once);
          doEmit(newSocket);
        });
      } else {
        doEmit(socket);
      }
    });
  };

  const submitAnswer = (questionId: number, selectedAnswer: string) => {
    return new Promise<any>((resolve) => {
      if (!socket) return resolve(null);
      let cleared = false;
      const timeout = setTimeout(() => {
        if (!cleared) {
          cleared = true;
          resolve(null);
        }
      }, 5000);

      try {
        socket.emit(
          "submit_answer",
          { questionId, selectedAnswer },
          (ack: any) => {
            if (cleared) return;
            cleared = true;
            clearTimeout(timeout);
            const ok = ack?.ok ?? true;
            if (ok) {
              setMyAnswerSubmitted(true);
              setMyAnswerForQuestionId(questionId);
              setMySelectedAnswer(selectedAnswer);
            }
            resolve(ack ?? null);
          }
        );
      } catch (err) {
        if (!cleared) {
          cleared = true;
          clearTimeout(timeout);
          resolve(null);
        }
      }
    });
  };

  const connectAsAdmin = (token: string) => {
    try {
      // If there's an existing socket (possibly anonymous), disconnect it so we can
      // reconnect with admin auth in the handshake. This ensures the server
      // recognizes this connection as admin (socket.data.isAdmin = true).
      if (socket) {
        try {
          socket.disconnect();
        } catch (e) {
          /* ignore */
        }
        setSocket(null);
      }
    } catch (e) {
      /* ignore */
    }
    initializeSocket(token);
  };

  const adminStartGame = () => {
    return new Promise<any>((resolve) => {
      if (!socket) return resolve(null);
      let cleared = false;
      const timeout = setTimeout(() => {
        if (!cleared) {
          cleared = true;
          resolve(null);
        }
      }, 5000);

      try {
        socket.emit("admin_start_game", undefined, (ack: any) => {
          if (cleared) return;
          cleared = true;
          clearTimeout(timeout);
          resolve(ack ?? null);
        });
      } catch (err) {
        if (!cleared) {
          cleared = true;
          clearTimeout(timeout);
          resolve(null);
        }
      }
    });
  };

  const adminStartQuestion = (questionId: number) => {
    if (socket) {
      socket.emit("admin_start_question", { questionId });
    }
  };

  const adminEndQuestion = (questionId: number) => {
    if (socket) {
      socket.emit("admin_end_question", { questionId });
    }
  };

  useEffect(() => {
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

  const value: SocketContextType = {
    socket,
    isConnected,
    participant,
    currentQuestion,
    questionLeaderboard,
    gameLeaderboard,
    lobbyParticipants,
    gameStatus,
    joinQuiz,
    submitAnswer,
    connectAsAdmin,
    adminStartGame,
    adminStartQuestion,
    adminEndQuestion,
    setLobbyParticipantsLocal: (p: Participant[]) => setLobbyParticipants(p),
    setGameStatusLocal: (s: "idle" | "active" | "ended") => setGameStatus(s),
    setGameLeaderboardLocal: (g: GameLeaderboardEntry[]) =>
      setGameLeaderboard(g),
    setQuestionLeaderboardLocal: (q: QuestionLeaderboardRow[]) =>
      setQuestionLeaderboard(q),
    setParticipantLocal: (p: Participant | null) => setParticipant(p),
    myAnswerSubmitted,
    myAnswerForQuestionId,
    mySelectedAnswer,
    adminOnline,
  };

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};
