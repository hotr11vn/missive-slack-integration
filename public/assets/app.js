/**
 * ═══════════════════════════════════════════════════════════════════
 * Missive → Slack  |  Sidebar Application
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  "use strict";

  // ── Configuration ──────────────────────────────────────────────────
  const API_BASE = "";

  // ── DOM references ─────────────────────────────────────────────────
  const $stateEmpty   = document.getElementById("state-empty");
  const $stateReady   = document.getElementById("state-ready");
  const $stateLoading = document.getElementById("state-loading");
  const $stateError   = document.getElementById("state-error");
  const $errorMessage = document.getElementById("error-message");

  const $emailSubject = document.getElementById("email-subject");
  const $emailFrom    = document.getElementById("email-from");
  const $emailTo      = document.getElementById("email-to");
  const $emailDate    = document.getElementById("email-date");
  const $emailBody    = document.getElementById("email-body");

  const $tabUsers     = document.getElementById("tab-users");
  const $tabChannels  = document.getElementById("tab-channels");
  const $search       = document.getElementById("slack-search");
  const $list         = document.getElementById("slack-list");
  
  const $selectedTarget = document.getElementById("selected-target");
  const $selectedAvatar = document.getElementById("selected-avatar");
  const $selectedName   = document.getElementById("selected-name");
  const $clearTarget    = document.getElementById("clear-target");

  const $personalNote = document.getElementById("personal-note");
  const $btnSend      = document.getElementById("btn-send");
  const $btnLabel     = document.getElementById("btn-send-label");
  const $btnSpinner   = document.getElementById("btn-send-spinner");
  const $status       = document.getElementById("status");

  // ── State ──────────────────────────────────────────────────────────
  let slackUsers = [];
  let slackChannels = [];
  let activeTab = "users"; // "users" or "channels"
  let selectedTarget = null;
  let currentEmail = null;
  let currentConversationId = null;
  let dataLoaded = false;

  // ── UI helpers ─────────────────────────────────────────────────────

  function showState(name) {
    [$stateEmpty, $stateReady, $stateLoading, $stateError].forEach((el) =>
      el.classList.add("hidden")
    );
    const target = {
      empty: $stateEmpty,
      ready: $stateReady,
      loading: $stateLoading,
      error: $stateError,
    }[name];
    if (target) target.classList.remove("hidden");
  }

  function showError(msg) {
    $errorMessage.textContent = msg;
    showState("error");
  }

  function showStatus(msg, type) {
    $status.textContent = msg;
    $status.className = "status status--" + type;
    $status.classList.remove("hidden");
    if (type === "success") {
      setTimeout(function () { $status.classList.add("hidden"); }, 5000);
    }
  }

  function hideStatus() {
    $status.classList.add("hidden");
  }

  function setLoading(on) {
    $btnSend.disabled = on || !selectedTarget;
    $btnLabel.textContent = on ? "Sending…" : "Send to Slack";
    $btnSpinner.classList.toggle("hidden", !on);
  }

  function stripHtml(html) {
    if (!html) return "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function formatContact(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (Array.isArray(field)) {
      return field.map(formatContact).filter(Boolean).join(", ");
    }
    if (field.name && field.address) return field.name + " <" + field.address + ">";
    return field.address || field.name || "";
  }

  // ── Slack target picker ────────────────────────────────────────────

  function renderList(filter) {
    var q = (filter || "").toLowerCase();
    var items = activeTab === "users" ? slackUsers : slackChannels;
    
    var filtered = q
      ? items.filter(function (item) {
          var name = (item.displayName || item.name || "").toLowerCase();
          return name.includes(q) || (item.email && item.email.toLowerCase().includes(q));
        })
      : items;

    $list.innerHTML = "";

    if (!filtered.length) {
      var li = document.createElement("li");
      li.className = "dropdown__empty";
      li.textContent = q ? "No matches found" : "Loading " + activeTab + "…";
      $list.appendChild(li);
      $list.classList.remove("hidden");
      return;
    }

    filtered.slice(0, 50).forEach(function (item) {
      var li = document.createElement("li");
      
      if (activeTab === "users") {
        var img = document.createElement("img");
        img.src = item.avatar || "";
        img.alt = "";
        img.width = 24;
        img.height = 24;
        li.appendChild(img);
      } else {
        var icon = document.createElement("span");
        icon.textContent = "#";
        icon.style.marginRight = "8px";
        icon.style.fontWeight = "bold";
        li.appendChild(icon);
      }

      var span = document.createElement("span");
      span.textContent = item.displayName || item.name;
      li.appendChild(span);

      li.addEventListener("click", function () { selectTarget(item); });
      $list.appendChild(li);
    });

    $list.classList.remove("hidden");
  }

  function selectTarget(target) {
    selectedTarget = target;
    if (activeTab === "users") {
      $selectedAvatar.src = target.avatar || "";
      $selectedAvatar.classList.remove("hidden");
    } else {
      $selectedAvatar.classList.add("hidden");
    }
    $selectedName.textContent = target.displayName || target.name;
    $selectedTarget.classList.remove("hidden");
    $search.value = "";
    $list.classList.add("hidden");
    $btnSend.disabled = false;
    hideStatus();
  }

  function clearTarget() {
    selectedTarget = null;
    $selectedTarget.classList.add("hidden");
    $btnSend.disabled = true;
    $search.value = "";
  }

  // ── Fetch Slack data from our API ──────────────────────────────────

  async function loadSlackData() {
    if (dataLoaded) return;
    try {
      var res = await fetch(API_BASE + "/api/slack/users");
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load Slack data");
      
      slackUsers = data.members || [];
      slackChannels = data.channels || [];
      dataLoaded = true;
    } catch (err) {
      console.error("[Share to Slack] Failed to load Slack data:", err);
    }
  }

  // ── Display email data ─────────────────────────────────────────────

  function displayEmail(email) {
    currentEmail = email;
    $emailSubject.textContent = email.subject || "No Subject";
    $emailFrom.textContent = formatContact(email.from_field);
    $emailTo.textContent = formatContact(email.to_fields);

    if (email.delivered_at) {
      var ts = email.delivered_at;
      var d = new Date(typeof ts === "number" ? ts * 1000 : ts);
      $emailDate.textContent = d.toLocaleString();
    } else {
      $emailDate.textContent = "";
    }

    var bodyText = stripHtml(email.body || email.preview || "");
    $emailBody.textContent = bodyText.slice(0, 500);

    clearTarget();
    hideStatus();
    $personalNote.value = "";
    showState("ready");
  }

  // ── Missive integration ────────────────────────────────────────────

  async function handleConversationChange(ids) {
    if (!ids || !ids.length) {
      showState("empty");
      currentConversationId = null;
      return;
    }

    var conversationId = ids[0];
    if (conversationId === currentConversationId) return;
    currentConversationId = conversationId;

    showState("loading");

    try {
      var conversations = await Missive.fetchConversations(ids);
      if (!conversations || !conversations.length) {
        showState("empty");
        return;
      }

      var conv = conversations[0];
      var message = conv.latest_message;

      if (message && message.from_field) {
        displayEmail({
          subject: message.subject || conv.subject || "No Subject",
          from_field: message.from_field,
          to_fields: message.to_fields || [],
          body: message.body || "",
          preview: message.preview || "",
          delivered_at: message.delivered_at,
          _webUrl: conv.link || "",
        });
      } else {
        displayEmail({
          subject: conv.subject || "No Subject",
          from_field: conv.authors && conv.authors[0] ? conv.authors[0] : null,
          to_fields: [],
          body: "",
          preview: message ? message.preview || "" : "",
          delivered_at: message ? message.delivered_at : null,
          _webUrl: conv.link || "",
        });
      }
    } catch (err) {
      console.error("[Share to Slack] Error fetching conversation:", err);
      showError("Could not load email data.");
    }
  }

  function registerMissiveActions() {
    try {
      Missive.setActions([
        {
          label: "Share to Slack",
          contexts: ["message"],
          callback: function (action) {
            if (action && action.message && action.message.id) {
              Missive.fetchMessages([action.message.id])
                .then(function (msgs) {
                  if (msgs && msgs.length) {
                    var convLink = action.conversation ? action.conversation.link || "" : "";
                    displayEmail({
                      subject: msgs[0].subject || "No Subject",
                      from_field: msgs[0].from_field,
                      to_fields: msgs[0].to_fields || [],
                      body: msgs[0].body || "",
                      preview: msgs[0].preview || "",
                      delivered_at: msgs[0].delivered_at,
                      _webUrl: convLink,
                    });
                    Missive.openSelf();
                  }
                });
            }
          },
        },
      ]);
    } catch (e) {
      console.warn("[Share to Slack] Could not register Missive actions:", e);
    }
  }

  // ── Send to Slack ──────────────────────────────────────────────────

  async function sendToSlack() {
    if (!selectedTarget || !currentEmail) return;

    setLoading(true);
    hideStatus();

    var bodyContent = currentEmail.body || currentEmail.preview || "";
    var note = $personalNote.value.trim();
    if (note) {
      bodyContent = "_" + note + "_\n\n---\n\n" + bodyContent;
    }

    var payload = {
      channelId: selectedTarget.id,
      subject: currentEmail.subject || "No Subject",
      from: formatContact(currentEmail.from_field),
      to: formatContact(currentEmail.to_fields),
      body: bodyContent,
      date: currentEmail.delivered_at
        ? typeof currentEmail.delivered_at === "number"
          ? new Date(currentEmail.delivered_at * 1000).toISOString()
          : currentEmail.delivered_at
        : null,
      missiveLink: currentEmail._webUrl || null,
      // We will tell the API whether this is a DM or a channel
      isUser: activeTab === "users"
    };

    try {
      var res = await fetch(API_BASE + "/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "Send failed");

      showStatus("Sent successfully to " + (selectedTarget.displayName || selectedTarget.name) + "!", "success");
      
      try {
        Missive.alert({
          title: "Shared to Slack",
          message: "Email sent to " + (selectedTarget.displayName || selectedTarget.name),
        });
      } catch (_) {}
    } catch (err) {
      console.error("[Share to Slack] Send error:", err);
      showStatus("Failed to send: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Event listeners ────────────────────────────────────────────────

  $tabUsers.addEventListener("click", function() {
    activeTab = "users";
    $tabUsers.classList.add("active");
    $tabChannels.classList.remove("active");
    $search.placeholder = "Search users…";
    clearTarget();
    renderList($search.value);
  });

  $tabChannels.addEventListener("click", function() {
    activeTab = "channels";
    $tabChannels.classList.add("active");
    $tabUsers.classList.remove("active");
    $search.placeholder = "Search channels…";
    clearTarget();
    renderList($search.value);
  });

  $search.addEventListener("focus", function () {
    loadSlackData().then(function () {
      renderList($search.value);
    });
  });

  $search.addEventListener("input", function () {
    renderList($search.value);
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".select-wrapper") && !e.target.closest(".filter-tabs")) {
      $list.classList.add("hidden");
    }
  });

  $clearTarget.addEventListener("click", clearTarget);
  $btnSend.addEventListener("click", sendToSlack);

  // ── Initialise ─────────────────────────────────────────────────────

  function init() {
    showState("empty");
    loadSlackData();

    if (typeof Missive !== "undefined") {
      Missive.on("change:conversations", handleConversationChange);
      registerMissiveActions();
      
      // Check for initial conversation
      Missive.fetchConversations().then(function (ids) {
        if (ids && ids.length) handleConversationChange(ids);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
