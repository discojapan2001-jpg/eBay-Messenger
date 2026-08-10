import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  Users,
  FileText,
  Plus,
  RefreshCw,
  Check,
  AlertTriangle,
  X,
  Copy,
  Loader2,
  ChevronRight,
  Languages,
  Settings,
  Wifi,
  WifiOff,
  Tag,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";

const STATUSES = ["未対応", "対応中", "完了"];
const STATUS_STYLE = {
  未対応: { dot: "#f59e0b", bg: "rgba(245,158,11,0.12)", text: "#fbbf24" },
  対応中: { dot: "#22d3ee", bg: "rgba(34,211,238,0.12)", text: "#67e8f9" },
  完了: { dot: "#34d399", bg: "rgba(52,211,153,0.10)", text: "#6ee7b7" },
};

const DEFAULT_TEMPLATES = [
  {
    id: "t1",
    title: "発送遅延のお詫び",
    en: "Thank you for your patience. Your item has been slightly delayed but is on its way. I will share tracking details as soon as they update. I'm sorry for the inconvenience.",
  },
  {
    id: "t2",
    title: "購入お礼メッセージ",
    en: "Thank you very much for your purchase! I will carefully pack your item and ship it out promptly. Please let me know if you have any questions before it arrives.",
  },
  {
    id: "t3",
    title: "商品説明との相違への対応",
    en: "I'm very sorry to hear that. Could you please share a photo of the item you received? I want to resolve this quickly, whether that means a replacement or a refund.",
  },
];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function translateToJapanese(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system:
        "You are a translator. Translate the given eBay buyer message from English into natural, polite Japanese. Output ONLY the Japanese translation, nothing else — no preamble, no quotes.",
      messages: [{ role: "user", content: text }],
    }),
  });
  const data = await res.json();
  const block = data?.content?.find((c) => c.type === "text");
  return block?.text?.trim() || "";
}

async function translateToEnglish(text) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system:
        "You are a translator. Translate the given Japanese reply into natural, polite English suitable for an eBay seller replying to a buyer. Output ONLY the English translation, nothing else — no preamble, no quotes.",
      messages: [{ role: "user", content: text }],
    }),
  });
  const data = await res.json();
  const block = data?.content?.find((c) => c.type === "text");
  return block?.text?.trim() || "";
}

function Section({ children }) {
  return (
    <div
      style={{
        background: "#121826",
        border: "1px solid rgba(34,211,238,0.15)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

function StatusPill({ status, onClick }) {
  const s = STATUS_STYLE[status];
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        background: s.bg,
        color: s.text,
        border: "none",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: s.dot,
          boxShadow: status === "未対応" ? `0 0 6px ${s.dot}` : "none",
        }}
      />
      {status}
    </button>
  );
}

export default function EbayMessenger() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("inbox");
  const [messages, setMessages] = useState([]);
  const [buyerNotes, setBuyerNotes] = useState({});
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [filter, setFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ buyerName: "", buyerId: "", text: "", category: "通常" });
  const [copiedId, setCopiedId] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const [gasConfig, setGasConfig] = useState({ url: "", token: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ url: "", token: "" });
  const [syncing, setSyncing] = useState(false);
  const [lastSyncOk, setLastSyncOk] = useState(null);
  const [offers, setOffers] = useState([]);
  const [offerActionId, setOfferActionId] = useState(null);

  // load
  useEffect(() => {
    (async () => {
      try {
        const [m, b, t, g, o] = await Promise.all([
          window.storage.get("ebay-messages").catch(() => null),
          window.storage.get("ebay-buyer-notes").catch(() => null),
          window.storage.get("ebay-templates").catch(() => null),
          window.storage.get("ebay-gas-config").catch(() => null),
          window.storage.get("ebay-offers").catch(() => null),
        ]);
        if (m?.value) setMessages(JSON.parse(m.value));
        if (b?.value) setBuyerNotes(JSON.parse(b.value));
        if (t?.value) setTemplates(JSON.parse(t.value));
        if (o?.value) setOffers(JSON.parse(o.value));
        if (g?.value) {
          const parsed = JSON.parse(g.value);
          setGasConfig(parsed);
          setSettingsForm(parsed);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (key, value) => {
    try {
      const r = await window.storage.set(key, JSON.stringify(value), false);
      if (!r) setSaveError(true);
    } catch (e) {
      console.error(e);
      setSaveError(true);
    }
  }, []);

  const saveMessages = (next) => {
    setMessages(next);
    persist("ebay-messages", next);
  };
  const saveBuyerNotes = (next) => {
    setBuyerNotes(next);
    persist("ebay-buyer-notes", next);
  };
  const saveTemplates = (next) => {
    setTemplates(next);
    persist("ebay-templates", next);
  };

  const addMessage = async () => {
    if (!form.text.trim() || !form.buyerName.trim()) return;
    const newMsg = {
      id: uid(),
      buyerName: form.buyerName.trim(),
      buyerId: form.buyerId.trim() || form.buyerName.trim(),
      original: form.text.trim(),
      translated: "",
      translating: true,
      status: "未対応",
      category: form.category,
      createdAt: Date.now(),
      replyDraft: "",
      replyEn: "",
      replyTranslating: false,
      replyFailed: false,
    };
    const next = [newMsg, ...messages];
    saveMessages(next);
    setForm({ buyerName: "", buyerId: "", text: "", category: "通常" });
    setShowForm(false);

    try {
      const ja = await translateToJapanese(newMsg.original);
      updateMessages((prev) =>
        prev.map((m) => (m.id === newMsg.id ? { ...m, translated: ja, translating: false } : m))
      );
    } catch (e) {
      updateMessages((prev) =>
        prev.map((m) =>
          m.id === newMsg.id ? { ...m, translated: "", translating: false, translateFailed: true } : m
        )
      );
    }
  };

  const updateMessages = (updater) => {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persist("ebay-messages", next);
      return next;
    });
  };

  const retryTranslate = async (msg) => {
    updateMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, translating: true, translateFailed: false } : m))
    );
    try {
      const ja = await translateToJapanese(msg.original);
      updateMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, translated: ja, translating: false } : m))
      );
    } catch (e) {
      updateMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, translating: false, translateFailed: true } : m))
      );
    }
  };

  const saveGasConfig = (next) => {
    setGasConfig(next);
    persist("ebay-gas-config", next);
  };

  const syncFromGas = useCallback(async () => {
    if (!gasConfig.url || !gasConfig.token) return;
    setSyncing(true);
    try {
      const since = messages.length ? Math.max(...messages.map((m) => m.createdAt || 0)) : 0;
      const url = `${gasConfig.url}?action=messages&token=${encodeURIComponent(
        gasConfig.token
      )}&since=${since}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.error) {
        setLastSyncOk(false);
        setSyncing(false);
        return;
      }
      const existingIds = new Set(messages.map((m) => m.id));
      const fresh = (Array.isArray(data) ? data : []).filter((d) => !existingIds.has(d.id));

      if (fresh.length > 0) {
        const toAdd = fresh.map((d) => ({
          id: d.id,
          buyerName: d.buyerName,
          buyerId: d.buyerId,
          original: d.text,
          translated: "",
          translating: true,
          status: "未対応",
          category: d.category || "通常",
          createdAt: d.createdAt,
          replyDraft: "",
          replyEn: "",
          replyTranslating: false,
          replyFailed: false,
        }));
        updateMessages((prev) => [...toAdd, ...prev]);

        toAdd.forEach(async (msg) => {
          try {
            const ja = await translateToJapanese(msg.original);
            updateMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, translated: ja, translating: false } : m))
            );
          } catch (e) {
            updateMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, translating: false, translateFailed: true } : m))
            );
          }
        });
      }
      setLastSyncOk(true);
    } catch (e) {
      setLastSyncOk(false);
    } finally {
      setSyncing(false);
    }

    // オファーは有効期間が短いのでスナップショットとして毎回取得し直す
    try {
      const offerUrl = `${gasConfig.url}?action=offers&token=${encodeURIComponent(gasConfig.token)}`;
      const offerRes = await fetch(offerUrl);
      const offerData = await offerRes.json();
      if (Array.isArray(offerData)) {
        setOffers(offerData);
        persist("ebay-offers", offerData);
      }
    } catch (e) {
      // オファー取得の失敗はメッセージ同期の成否とは分けて無視(次回ポーリングで再試行)
    }
  }, [gasConfig, messages]);

  const respondToOffer = async (offer, decision) => {
    if (!gasConfig.url || !gasConfig.token) return;
    setOfferActionId(offer.offerId);
    try {
      const res = await fetch(gasConfig.url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          token: gasConfig.token,
          action: "respond",
          itemId: offer.itemId,
          offerId: offer.offerId,
          decision,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        const next = offers.filter((o) => o.offerId !== offer.offerId);
        setOffers(next);
        persist("ebay-offers", next);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setOfferActionId(null);
    }
  };

  useEffect(() => {
    if (!ready || !gasConfig.url || !gasConfig.token) return;
    syncFromGas();
    const interval = setInterval(syncFromGas, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gasConfig.url, gasConfig.token]);

  const setReplyDraft = (id, text) => {
    updateMessages((prev) => prev.map((m) => (m.id === id ? { ...m, replyDraft: text } : m)));
  };

  const translateReply = async (msg) => {
    if (!msg.replyDraft?.trim()) return;
    updateMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, replyTranslating: true, replyFailed: false } : m))
    );
    try {
      const en = await translateToEnglish(msg.replyDraft.trim());
      updateMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, replyEn: en, replyTranslating: false } : m))
      );
    } catch (e) {
      updateMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, replyTranslating: false, replyFailed: true } : m))
      );
    }
  };

  const cycleStatus = (msg) => {
    const idx = STATUSES.indexOf(msg.status);
    const nextStatus = STATUSES[(idx + 1) % STATUSES.length];
    updateMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: nextStatus } : m)));
  };

  const copyText = (id, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  };

  // derive buyer stats
  const buyerStats = {};
  messages.forEach((m) => {
    if (!buyerStats[m.buyerId]) {
      buyerStats[m.buyerId] = { buyerId: m.buyerId, name: m.buyerName, count: 0, last: 0 };
    }
    buyerStats[m.buyerId].count += 1;
    buyerStats[m.buyerId].last = Math.max(buyerStats[m.buyerId].last, m.createdAt);
  });
  const buyers = Object.values(buyerStats).sort((a, b) => b.count - a.count);

  const filtered = messages.filter((m) => {
    if (filter === "all") return true;
    if (filter === "trouble") return m.category === "トラブル";
    return m.status === filter;
  });

  const unresolvedCount = messages.filter((m) => m.status !== "完了").length;

  if (!ready) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0e1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Loader2 color="#22d3ee" size={28} style={{ animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg,#0a0e1a 0%,#0d1220 100%)",
        color: "#e2e8f0",
        fontFamily: "system-ui,-apple-system,'Hiragino Kaku Gothic ProN',sans-serif",
        paddingBottom: 84,
      }}
    >
      {/* header */}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ padding: "20px 16px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageSquare color="#22d3ee" size={22} />
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              margin: 0,
              color: "#67e8f9",
              textShadow: "0 0 14px rgba(34,211,238,0.35)",
            }}
          >
            eBay顧客対応
          </h1>
        </div>
        <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0 0 30px" }}>
          未対応 {unresolvedCount} 件
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0 0 30px" }}>
          {gasConfig.url ? (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: lastSyncOk === false ? "#f87171" : "#6ee7b7" }}>
              {syncing ? (
                <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
              ) : lastSyncOk === false ? (
                <WifiOff size={11} />
              ) : (
                <Wifi size={11} />
              )}
              {syncing ? "同期中..." : lastSyncOk === false ? "同期エラー" : "自動受信 有効"}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: "#64748b" }}>自動受信 未設定</span>
          )}
          <button
            onClick={() => {
              setSettingsForm(gasConfig);
              setShowSettings(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              background: "none",
              border: "none",
              color: "#64748b",
              fontSize: 11,
              cursor: "pointer",
              padding: 0,
            }}
          >
            <Settings size={12} /> 設定
          </button>
        </div>
        {saveError && (
          <p style={{ fontSize: 11, color: "#f87171", margin: "6px 0 0 30px" }}>
            保存に失敗しました。もう一度お試しください。
          </p>
        )}
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        {tab === "inbox" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
              <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                {[
                  ["all", "全て"],
                  ["未対応", "未対応"],
                  ["対応中", "対応中"],
                  ["trouble", "トラブル"],
                  ["完了", "完了"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    style={{
                      flexShrink: 0,
                      padding: "6px 12px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      border: filter === key ? "1px solid #22d3ee" : "1px solid rgba(148,163,184,0.2)",
                      background: filter === key ? "rgba(34,211,238,0.12)" : "transparent",
                      color: filter === key ? "#67e8f9" : "#94a3b8",
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {gasConfig.url && (
                <button
                  onClick={syncFromGas}
                  disabled={syncing}
                  style={{
                    flexShrink: 0,
                    marginLeft: "auto",
                    background: "none",
                    border: "1px solid rgba(148,163,184,0.2)",
                    borderRadius: 999,
                    padding: "6px 8px",
                    color: "#94a3b8",
                    cursor: "pointer",
                  }}
                >
                  <RefreshCw size={13} style={syncing ? { animation: "spin 1s linear infinite" } : {}} />
                </button>
              )}
            </div>

            {filtered.length === 0 && (
              <Section>
                <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", margin: 0 }}>
                  メッセージがありません。右下の + から追加してください。
                </p>
              </Section>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: "#121826",
                    border: "1px solid rgba(148,163,184,0.12)",
                    borderLeft:
                      m.category === "トラブル" ? "3px solid #f87171" : "3px solid rgba(34,211,238,0.4)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {m.buyerName}
                      {buyerStats[m.buyerId]?.count > 1 && (
                        <span style={{ color: "#22d3ee", fontWeight: 600, fontSize: 11, marginLeft: 6 }}>
                          リピーター ×{buyerStats[m.buyerId].count}
                        </span>
                      )}
                    </div>
                    <StatusPill status={m.status} onClick={() => cycleStatus(m)} />
                  </div>

                  <p style={{ fontSize: 13, color: "#94a3b8", margin: "8px 0 4px", lineHeight: 1.5 }}>
                    {m.original}
                  </p>

                  {m.translating ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <Loader2 size={12} color="#22d3ee" style={{ animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: 12, color: "#22d3ee" }}>翻訳中...</span>
                    </div>
                  ) : m.translateFailed ? (
                    <button
                      onClick={() => retryTranslate(m)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 4,
                        background: "none",
                        border: "none",
                        color: "#f87171",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      <RefreshCw size={12} /> 翻訳に失敗 - 再試行
                    </button>
                  ) : m.translated ? (
                    <div
                      style={{
                        marginTop: 6,
                        paddingTop: 8,
                        borderTop: "1px dashed rgba(148,163,184,0.15)",
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      <Languages size={13} color="#67e8f9" style={{ flexShrink: 0, marginTop: 2 }} />
                      <p style={{ fontSize: 13, color: "#e2e8f0", margin: 0, lineHeight: 1.5 }}>
                        {m.translated}
                      </p>
                    </div>
                  ) : null}

                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px dashed rgba(148,163,184,0.15)",
                    }}
                  >
                    <textarea
                      placeholder="返信を日本語で入力..."
                      value={m.replyDraft || ""}
                      onChange={(e) => setReplyDraft(m.id, e.target.value)}
                      style={{
                        width: "100%",
                        background: "#0d1320",
                        border: "1px solid rgba(148,163,184,0.15)",
                        borderRadius: 8,
                        color: "#e2e8f0",
                        fontSize: 13,
                        padding: 8,
                        resize: "vertical",
                        minHeight: 44,
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      onClick={() => translateReply(m)}
                      disabled={!m.replyDraft?.trim() || m.replyTranslating}
                      style={{
                        marginTop: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        background: "rgba(34,211,238,0.12)",
                        border: "none",
                        color: "#67e8f9",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: !m.replyDraft?.trim() ? "not-allowed" : "pointer",
                        opacity: !m.replyDraft?.trim() ? 0.5 : 1,
                      }}
                    >
                      {m.replyTranslating ? (
                        <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                      ) : (
                        <Languages size={12} />
                      )}
                      {m.replyTranslating ? "英訳中..." : "英語に翻訳"}
                    </button>

                    {m.replyFailed && (
                      <p style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>
                        翻訳に失敗しました。もう一度お試しください。
                      </p>
                    )}

                    {m.replyEn && !m.replyTranslating && (
                      <div
                        style={{
                          marginTop: 8,
                          background: "#0d1320",
                          border: "1px solid rgba(52,211,153,0.2)",
                          borderRadius: 8,
                          padding: 10,
                        }}
                      >
                        <p style={{ fontSize: 13, color: "#e2e8f0", margin: 0, lineHeight: 1.5 }}>
                          {m.replyEn}
                        </p>
                        <button
                          onClick={() => copyText(m.id + "-reply", m.replyEn)}
                          style={{
                            marginTop: 8,
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            background:
                              copiedId === m.id + "-reply" ? "rgba(52,211,153,0.15)" : "rgba(148,163,184,0.1)",
                            border: "none",
                            color: copiedId === m.id + "-reply" ? "#6ee7b7" : "#94a3b8",
                            borderRadius: 8,
                            padding: "5px 9px",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {copiedId === m.id + "-reply" ? <Check size={12} /> : <Copy size={12} />}
                          {copiedId === m.id + "-reply" ? "コピー済" : "コピー"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "offers" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {offers.length === 0 && (
              <Section>
                <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", margin: 0 }}>
                  現在、有効なオファーはありません。
                </p>
              </Section>
            )}
            {offers.map((o) => (
              <div
                key={o.offerId}
                style={{
                  background: "#121826",
                  border: "1px solid rgba(148,163,184,0.12)",
                  borderLeft: "3px solid #f59e0b",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>{o.buyerId}</div>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "4px 0 8px", lineHeight: 1.4 }}>
                  {o.title || o.itemId}
                </p>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#fbbf24" }}>
                  {o.currency} {o.price}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => respondToOffer(o, "accept")}
                    disabled={offerActionId === o.offerId}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: "none",
                      background: "rgba(52,211,153,0.15)",
                      color: "#6ee7b7",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <ThumbsUp size={14} /> 承諾
                  </button>
                  <button
                    onClick={() => respondToOffer(o, "decline")}
                    disabled={offerActionId === o.offerId}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 5,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: "none",
                      background: "rgba(248,113,113,0.12)",
                      color: "#f87171",
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <ThumbsDown size={14} /> 却下
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "buyers" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {buyers.length === 0 && (
              <Section>
                <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", margin: 0 }}>
                  まだ購入者データがありません。
                </p>
              </Section>
            )}
            {buyers.map((b) => (
              <Section key={b.buyerId}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      やり取り {b.count} 件・最終{" "}
                      {new Date(b.last).toLocaleDateString("ja-JP")}
                    </div>
                  </div>
                  {b.count > 1 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#67e8f9",
                        background: "rgba(34,211,238,0.12)",
                        padding: "3px 8px",
                        borderRadius: 999,
                      }}
                    >
                      リピーター
                    </span>
                  )}
                </div>
                <textarea
                  placeholder="メモ(好み・注意点など)"
                  value={buyerNotes[b.buyerId] || ""}
                  onChange={(e) =>
                    saveBuyerNotes({ ...buyerNotes, [b.buyerId]: e.target.value })
                  }
                  style={{
                    width: "100%",
                    marginTop: 10,
                    background: "#0d1320",
                    border: "1px solid rgba(148,163,184,0.15)",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    fontSize: 12,
                    padding: 8,
                    resize: "vertical",
                    minHeight: 36,
                    boxSizing: "border-box",
                  }}
                />
              </Section>
            ))}
          </div>
        )}

        {tab === "templates" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {templates.map((t) => (
              <Section key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</div>
                  <button
                    onClick={() => copyText(t.id, t.en)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      background: copiedId === t.id ? "rgba(52,211,153,0.15)" : "rgba(34,211,238,0.12)",
                      border: "none",
                      color: copiedId === t.id ? "#6ee7b7" : "#67e8f9",
                      borderRadius: 8,
                      padding: "5px 9px",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {copiedId === t.id ? <Check size={12} /> : <Copy size={12} />}
                    {copiedId === t.id ? "コピー済" : "コピー"}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "#94a3b8", margin: "8px 0 0", lineHeight: 1.5 }}>{t.en}</p>
              </Section>
            ))}
          </div>
        )}
      </div>

      {/* settings modal */}
      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            zIndex: 20,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#101623",
              borderTop: "1px solid rgba(34,211,238,0.25)",
              borderRadius: "18px 18px 0 0",
              padding: 18,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>自動受信の設定</span>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none" }}>
                <X color="#94a3b8" size={20} />
              </button>
            </div>
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 0, marginBottom: 10, lineHeight: 1.5 }}>
              Google Apps ScriptのWebアプリURLとトークンを入力してください。
            </p>
            <input
              placeholder="GAS Web App URL (https://script.google.com/macros/s/.../exec)"
              value={settingsForm.url}
              onChange={(e) => setSettingsForm({ ...settingsForm, url: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="トークン(SHARED_SECRET)"
              value={settingsForm.token}
              onChange={(e) => setSettingsForm({ ...settingsForm, token: e.target.value })}
              style={inputStyle}
            />
            <button
              onClick={() => {
                saveGasConfig(settingsForm);
                setShowSettings(false);
                setLastSyncOk(null);
              }}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                fontSize: 14,
                color: "#0a0e1a",
                background: "#22d3ee",
                cursor: "pointer",
              }}
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* add form modal */}
      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            zIndex: 20,
          }}
          onClick={() => setShowForm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              background: "#101623",
              borderTop: "1px solid rgba(34,211,238,0.25)",
              borderRadius: "18px 18px 0 0",
              padding: 18,
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>メッセージを追加</span>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none" }}>
                <X color="#94a3b8" size={20} />
              </button>
            </div>
            <input
              placeholder="購入者名"
              value={form.buyerName}
              onChange={(e) => setForm({ ...form, buyerName: e.target.value })}
              style={inputStyle}
            />
            <input
              placeholder="購入者ID(任意)"
              value={form.buyerId}
              onChange={(e) => setForm({ ...form, buyerId: e.target.value })}
              style={inputStyle}
            />
            <textarea
              placeholder="受信メッセージ本文(英語)"
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {["通常", "トラブル"].map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, category: c })}
                  style={{
                    flex: 1,
                    padding: "8px 0",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: form.category === c ? "1px solid #22d3ee" : "1px solid rgba(148,163,184,0.2)",
                    background: form.category === c ? "rgba(34,211,238,0.12)" : "transparent",
                    color: form.category === c ? "#67e8f9" : "#94a3b8",
                  }}
                >
                  {c === "トラブル" && <AlertTriangle size={12} style={{ marginRight: 4, verticalAlign: -2 }} />}
                  {c}
                </button>
              ))}
            </div>
            <button
              onClick={addMessage}
              disabled={!form.text.trim() || !form.buyerName.trim()}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 10,
                border: "none",
                fontWeight: 700,
                fontSize: 14,
                color: "#0a0e1a",
                background:
                  !form.text.trim() || !form.buyerName.trim() ? "rgba(34,211,238,0.3)" : "#22d3ee",
                cursor: !form.text.trim() || !form.buyerName.trim() ? "not-allowed" : "pointer",
              }}
            >
              追加して翻訳
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      {tab === "inbox" && (
        <button
          onClick={() => setShowForm(true)}
          style={{
            position: "fixed",
            right: 20,
            bottom: 92,
            width: 52,
            height: 52,
            borderRadius: "50%",
            background: "#22d3ee",
            border: "none",
            boxShadow: "0 4px 18px rgba(34,211,238,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 10,
          }}
        >
          <Plus color="#0a0e1a" size={24} />
        </button>
      )}

      {/* bottom nav */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#0d1220",
          borderTop: "1px solid rgba(148,163,184,0.12)",
          display: "flex",
          padding: "10px 0 calc(10px + env(safe-area-inset-bottom))",
        }}
      >
        {[
          ["inbox", "受信", MessageSquare],
          ["offers", "オファー", Tag],
          ["buyers", "リピーター", Users],
          ["templates", "テンプレート", FileText],
        ].map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              cursor: "pointer",
              color: tab === key ? "#22d3ee" : "#64748b",
            }}
          >
            <Icon size={19} />
            <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  background: "#0d1320",
  border: "1px solid rgba(148,163,184,0.15)",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "10px 12px",
  marginBottom: 10,
  boxSizing: "border-box",
};
