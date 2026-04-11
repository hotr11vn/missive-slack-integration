/**
 * ═══════════════════════════════════════════════════════════════════
 * Missive → Slack  |  Sidebar Application
 *
 * This script runs inside the Missive sidebar iFrame.  It:
 *   1. Registers a "Share to Slack" action in Missive's context menu
 *   2. Listens for conversation changes to update the email preview
 *   3. Fetches Slack workspace users for the recipient picker
 *   4. Sends the email content to a chosen Slack user via our API
 * ═══════════════════════════════════════════════════════════════════
 */

(function () {
  "use strict";

  // ── Configuration ──────────────────────────────────────────────────
  // The API base is the same origin as this page (Vercel serves both).
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

  const $userSearch   = document.getElementById("slack-user-search");
  const $userList     = document.getElementById("slack-user-list");
  const $selectedUser = document.getElementById("selected-user");
  const $selectedAvatar = document.getElementById("selected-avatar");
  const $selectedName = document.getElementById("selected-name");
  const $clearUser    = document.getElementById("clear-user");

  const $personalNote = document.getElementById("personal-note");
  const $btnSend      = document.getElementById("btn-send");
  const $btnLabel     = document.getElementById("btn-send-label");
  const $btnSpinner   = document.getElementById("btn-send-spinner");
  const $status       = document.getElementById("status");

  // ── State ──────────────────────────────────────────────────────────
  let slackUsers = [];            // cached user list from Slack
  let selectedSlackUser = null;   // currently picked Slack user
  let currentEmail = null;        // email data from Missive
  let currentConversationId = null;
  let usersLoaded = false;

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
    $btnSend.disabled = on || !selectedSlackUser;
    $btnLabel.textContent = on ? "Sending…" : "Send to Slack";
    $btnSpinner.classList.toggle("hidden", !on);
  }

  /**
   * Strip HTML tags for the preview card body.
   */
  function stripHtml(html) {
    if (!html) return "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  /**
   * Format a contact field (AddressField) into a readable string.
   * Missive returns: { name: "...", address: "..." }
   */
  function formatContact(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (Array.isArray(field)) {
      return field.map(formatContact).filter(Boolean).join(", ");
    }
    if (field.name && field.address) return field.name + " <" + field.address + ">";
    return field.address || field.name || "";
  }

  // ── Slack user picker ──────────────────────────────────────────────

  function renderUserList(filter) {
    var q = (filter || "").toLowerCase();
    var filtered = q
      ? slackUsers.filter(function (u) {
          return (
            u.displayName.toLowerCase().includes(q) ||
            u.name.toLowerCase().includes(q) ||
            (u.email && u.email.toLowerCase().includes(q))
          );
        })
      : slackUsers;

    $userList.innerHTML = "";

    if (!filtered.length) {
      var li = document.createElement("li");
      li.className = "dropdown__empty";
      li.textContent = q ? "No users found" : "Loading users…";
      $userList.appendChild(li);
      $userList.classList.remove("hidden");
      return;
    }

    filtered.slice(0, 50).forEach(function (user) {
      var li = document.createElement("li");
      li.dataset.id = user.id;

      var img = document.createElement("img");
      img.src = user.avatar || "";
      img.alt = "";
      img.width = 24;
      img.height = 24;

      var span = document.createElement("span");
      span.textContent = user.displayName;

      li.appendChild(img);
      li.appendChild(span);

      li.addEventListener("click", function () { selectUser(user); });
      $userList.appendChild(li);
    });

    $userList.classList.remove("hidden");
  }

  function selectUser(user) {
    selectedSlackUser = user;
    $selectedAvatar.src = user.avatar || "";
    $selectedName.textContent = user.displayName;
    $selectedUser.classList.remove("hidden");
    $userSearch.value = "";
    $userList.classList.add("hidden");
    $btnSend.disabled = false;
    hideStatus();
  }

  function clearUser() {
    selectedSlackUser = null;
    $selectedUser.classList.add("hidden");
    $btnSend.disabled = true;
    $userSearch.value = "";
  }

  // ── Fetch Slack users from our API ─────────────────────────────────

  async function loadSlackUsers() {
    if (usersLoaded) return;
    try {
      var res = await fetch(API_BASE + "/api/slack/users");
      var data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load users");
      slackUsers = data.members || [];
      usersLoaded = true;
    } catch (err) {
      console.error("[Share to Slack] Failed to load Slack users:", err);
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
      // Missive delivers Unix timestamps in seconds
      var d = new Date(typeof ts === "number" ? ts * 1000 : ts);
      $emailDate.textContent = d.toLocaleString();
    } else {
      $emailDate.textContent = "";
    }

    var bodyText = stripHtml(email.body || email.preview || "");
    $emailBody.textContent = bodyText.slice(0, 500);

    // Reset send state
    clearUser();
    hideStatus();
    $personalNote.value = "";

    showState("ready");
  }

  // ── Missive integration ────────────────────────────────────────────

  /**
   * Fetch the conversation data for the given IDs and display the
   * latest email message.
   *
   * IMPORTANT: Missive SDK methods return Promises (not callbacks).
   * Reference: https://missiveapp.com/docs/developers/ui-iframe-integrations/javascript-api
   */
  async function handleConversationChange(ids) {
    console.log("[Share to Slack] change:conversations fired, ids:", ids);

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
      // fetchConversations returns a Promise that resolves with an array
      var conversations = await Missive.fetchConversations(ids);
      console.log("[Share to Slack] fetchConversations result:", conversations);

      if (!conversations || !conversations.length) {
        showState("empty");
        return;
      }

      var conv = conversations[0];

      // The conversation object has a `latest_message` with full email data
      var message = conv.latest_message;

      if (message && message.from_field) {
        displayEmail({
          subject: message.subject || conv.subject || "No Subject",
          from_field: message.from_field,
          to_fields: message.to_fields || [],
          cc_fields: message.cc_fields || [],
          body: message.body || "",
          preview: message.preview || "",
          delivered_at: message.delivered_at,
          _conversationId: conversationId,
          _webUrl: conv.link || "",
          _messageId: message.id,
        });
      } else {
        // Conversation might be a chat (no email message) — show what we have
        displayEmail({
          subject: conv.subject || "No Subject",
          from_field: conv.authors && conv.authors[0] ? conv.authors[0] : null,
          to_fields: [],
          body: "",
          preview: message ? message.preview || "" : "",
          delivered_at: message ? message.delivered_at : null,
          _conversationId: conversationId,
          _webUrl: conv.link || "",
        });
      }
    } catch (err) {
      console.error("[Share to Slack] Error fetching conversation:", err);
      showError("Could not load email data. " + (err.message || String(err)));
    }
  }

  /**
   * Register the "Share to Slack" action in Missive's context menu.
   *
   * When triggered from the message context menu, the callback receives
   * an object like: { message: { id, subject, ... }, conversation: { id, ... } }
   */
  function registerMissiveActions() {
    try {
      Missive.setActions([
        {
          label: "Share to Slack",
          contexts: ["message"],
          callback: function (action) {
            console.log("[Share to Slack] Action triggered:", action);

            // When triggered from message context, fetch that specific message
            if (action && action.message && action.message.id) {
              Missive.fetchMessages([action.message.id])
                .then(function (msgs) {
                  console.log("[Share to Slack] fetchMessages result:", msgs);
                  if (msgs && msgs.length) {
                    var convLink = "";
                    if (action.conversation && action.conversation.id) {
                      // We'll try to get the link from the conversation
                      convLink = action.conversation.link || "";
                    }
                    displayEmail({
                      subject: msgs[0].subject || "No Subject",
                      from_field: msgs[0].from_field,
                      to_fields: msgs[0].to_fields || [],
                      cc_fields: msgs[0].cc_fields || [],
                      body: msgs[0].body || "",
                      preview: msgs[0].preview || "",
                      delivered_at: msgs[0].delivered_at,
                      _conversationId: action.conversation
                        ? action.conversation.id
                        : "",
                      _webUrl: convLink,
                      _messageId: msgs[0].id,
                    });
                    // Open the sidebar to show the loaded email
                    Missive.openSelf();
                  }
                })
                .catch(function (err) {
                  console.error("[Share to Slack] fetchMessages error:", err);
                });
            }
          },
        },
      ]);
      console.log("[Share to Slack] Actions registered successfully");
    } catch (e) {
      console.warn("[Share to Slack] Could not register Missive actions:", e);
    }
  }

  // ── Send to Slack ──────────────────────────────────────────────────

  async function sendToSlack() {
    if (!selectedSlackUser || !currentEmail) return;

    setLoading(true);
    hideStatus();

    // Build the body text, prepending the personal note if provided
    var bodyContent = currentEmail.body || currentEmail.preview || "";
    var note = $personalNote.value.trim();
    if (note) {
      bodyContent = "_" + note + "_\n\n---\n\n" + bodyContent;
    }

    var payload = {
      userId: selectedSlackUser.id,
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
    };

    try {
      var res = await fetch(API_BASE + "/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      var data = await res.json();

      if (!data.ok) throw new Error(data.error || "Send failed");

      showStatus(
        "Sent to " + selectedSlackUser.displayName + " on Slack!",
        "success"
      );

      // Notify Missive that the action completed (optional toast)
      try {
        Missive.alert({
          title: "Shared to Slack",
          message: "Email sent to " + selectedSlackUser.displayName,
        });
      } catch (_) {
        // alert is non-critical
      }
    } catch (err) {
      console.error("[Share to Slack] Send error:", err);
      showStatus("Failed to send: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Event listeners ────────────────────────────────────────────────

  // User search / picker
  $userSearch.addEventListener("focus", function () {
    loadSlackUsers().then(function () {
      renderUserList($userSearch.value);
    });
  });

  $userSearch.addEventListener("input", function () {
    renderUserList($userSearch.value);
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".select-wrapper")) {
      $userList.classList.add("hidden");
    }
  });

  // Clear selected user
  $clearUser.addEventListener("click", clearUser);

  // Send button
  $btnSend.addEventListener("click", sendToSlack);

  // ── Initialise ─────────────────────────────────────────────────────

  function init() {
    console.log("[Share to Slack] Initialising...");
    console.log("[Share to Slack] Missive SDK available:", typeof Missive !== "undefined");

    showState("empty");

    // Pre-fetch Slack users in the background
    loadSlackUsers();

    if (typeof Missive !== "undefined") {
      // Register context-menu action
      registerMissiveActions();

      // Listen for conversation selection changes.
      // The { retroactive: true } option ensures the callback fires
      // immediately if a conversation is already selected when the
      // sidebar loads (which is the common case).
      Missive.on(
        "change:conversations",
        function (ids) {
          console.log("[Share to Slack] change:conversations event, ids:", ids);
          handleConversationChange(ids);
        },
        { retroactive: true }
      );

      console.log("[Share to Slack] Event listeners registered");
    } else {
      console.warn(
        "[Share to Slack] Missive SDK not detected — running in standalone/dev mode."
      );
    }
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
