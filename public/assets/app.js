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
    $status.className = `status status--${type}`;
    $status.classList.remove("hidden");
    if (type === "success") {
      setTimeout(() => $status.classList.add("hidden"), 5000);
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
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  /**
   * Format a field like from_field / to_fields into a readable string.
   * Missive returns these as objects: { name, address }.
   */
  function formatContact(field) {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (Array.isArray(field)) {
      return field.map(formatContact).filter(Boolean).join(", ");
    }
    if (field.name && field.address) return `${field.name} <${field.address}>`;
    return field.address || field.name || "";
  }

  // ── Slack user picker ──────────────────────────────────────────────

  function renderUserList(filter) {
    const q = (filter || "").toLowerCase();
    const filtered = q
      ? slackUsers.filter(
          (u) =>
            u.displayName.toLowerCase().includes(q) ||
            u.name.toLowerCase().includes(q) ||
            (u.email && u.email.toLowerCase().includes(q))
        )
      : slackUsers;

    $userList.innerHTML = "";

    if (!filtered.length) {
      const li = document.createElement("li");
      li.className = "dropdown__empty";
      li.textContent = q ? "No users found" : "Loading users…";
      $userList.appendChild(li);
      $userList.classList.remove("hidden");
      return;
    }

    filtered.slice(0, 50).forEach((user) => {
      const li = document.createElement("li");
      li.dataset.id = user.id;

      const img = document.createElement("img");
      img.src = user.avatar || "";
      img.alt = "";
      img.width = 24;
      img.height = 24;

      const span = document.createElement("span");
      span.textContent = user.displayName;

      li.appendChild(img);
      li.appendChild(span);

      li.addEventListener("click", () => selectUser(user));
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
      const res = await fetch(`${API_BASE}/api/slack/users`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load users");
      slackUsers = data.members || [];
      usersLoaded = true;
    } catch (err) {
      console.error("Failed to load Slack users:", err);
      // Non-fatal — user can retry by typing in the search box
    }
  }

  // ── Display email data ─────────────────────────────────────────────

  function displayEmail(email) {
    currentEmail = email;

    $emailSubject.textContent = email.subject || "No Subject";
    $emailFrom.textContent = formatContact(email.from_field);
    $emailTo.textContent = formatContact(email.to_fields);

    if (email.delivered_at) {
      const d = new Date(
        typeof email.delivered_at === "number"
          ? email.delivered_at * 1000
          : email.delivered_at
      );
      $emailDate.textContent = d.toLocaleString();
    } else {
      $emailDate.textContent = "";
    }

    const bodyText = stripHtml(email.body || email.preview || "");
    $emailBody.textContent = bodyText.slice(0, 500);

    // Reset send state
    clearUser();
    hideStatus();
    $personalNote.value = "";

    showState("ready");
  }

  // ── Missive integration ────────────────────────────────────────────

  /**
   * Fetch the first message of the given conversation IDs and display it.
   */
  async function handleConversationChange(ids) {
    if (!ids || !ids.length) {
      showState("empty");
      return;
    }

    const conversationId = ids[0];
    if (conversationId === currentConversationId) return;
    currentConversationId = conversationId;

    showState("loading");

    try {
      // Fetch conversation to get message IDs
      const conversations = await new Promise((resolve, reject) => {
        if (typeof Missive !== "undefined" && Missive.fetchConversations) {
          Missive.fetchConversations([conversationId], (err, data) => {
            if (err) return reject(err);
            resolve(data);
          });
        } else {
          reject(new Error("Missive SDK not available"));
        }
      });

      const conv = conversations && conversations[0];
      if (!conv) {
        showState("empty");
        return;
      }

      // If the conversation object already has message data, use it
      if (conv.messages && conv.messages.length) {
        displayEmail({
          ...conv.messages[0],
          _conversationId: conversationId,
          _webUrl: conv.web_url || conv.app_url || "",
        });
        return;
      }

      // Otherwise fetch messages by their IDs
      const messageIds =
        conv.message_ids || conv.email_message_ids || [];
      if (!messageIds.length) {
        displayEmail({
          subject: conv.subject || "No Subject",
          preview: conv.preview || "",
          _conversationId: conversationId,
          _webUrl: conv.web_url || conv.app_url || "",
        });
        return;
      }

      const messages = await new Promise((resolve, reject) => {
        Missive.fetchMessages(messageIds.slice(0, 1), (err, data) => {
          if (err) return reject(err);
          resolve(data);
        });
      });

      if (messages && messages.length) {
        displayEmail({
          ...messages[0],
          _conversationId: conversationId,
          _webUrl: conv.web_url || conv.app_url || "",
        });
      } else {
        displayEmail({
          subject: conv.subject || "No Subject",
          preview: conv.preview || "",
          _conversationId: conversationId,
          _webUrl: conv.web_url || conv.app_url || "",
        });
      }
    } catch (err) {
      console.error("Error fetching Missive data:", err);
      showError("Could not load email data. " + (err.message || ""));
    }
  }

  /**
   * Register the "Share to Slack" action in Missive's context menu.
   */
  function registerMissiveActions() {
    if (typeof Missive === "undefined") return;

    try {
      Missive.setActions([
        {
          label: "Share to Slack",
          contexts: ["message"],
          callback: function (context) {
            // When triggered from the context menu, fetch that specific message
            if (context && context.message && context.message.id) {
              Missive.fetchMessages([context.message.id], (err, msgs) => {
                if (!err && msgs && msgs.length) {
                  displayEmail({
                    ...msgs[0],
                    _conversationId: context.conversation
                      ? context.conversation.id
                      : "",
                    _webUrl: context.conversation
                      ? context.conversation.web_url || context.conversation.app_url || ""
                      : "",
                  });
                }
              });
            }
          },
        },
      ]);
    } catch (e) {
      console.warn("Could not register Missive actions:", e);
    }
  }

  // ── Send to Slack ──────────────────────────────────────────────────

  async function sendToSlack() {
    if (!selectedSlackUser || !currentEmail) return;

    setLoading(true);
    hideStatus();

    // Build the body text, prepending the personal note if provided
    let bodyContent = currentEmail.body || currentEmail.preview || "";
    const note = $personalNote.value.trim();
    if (note) {
      bodyContent = `_${note}_\n\n---\n\n${bodyContent}`;
    }

    const payload = {
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
      const res = await fetch(`${API_BASE}/api/slack/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!data.ok) throw new Error(data.error || "Send failed");

      showStatus(
        `Sent to ${selectedSlackUser.displayName} on Slack!`,
        "success"
      );

      // Notify Missive that the action completed (optional toast)
      if (typeof Missive !== "undefined" && Missive.alert) {
        Missive.alert({
          title: "Shared to Slack",
          message: `Email sent to ${selectedSlackUser.displayName}`,
        });
      }
    } catch (err) {
      console.error("Send error:", err);
      showStatus("Failed to send: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  // ── Event listeners ────────────────────────────────────────────────

  // User search / picker
  $userSearch.addEventListener("focus", () => {
    loadSlackUsers().then(() => renderUserList($userSearch.value));
  });

  $userSearch.addEventListener("input", () => {
    renderUserList($userSearch.value);
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
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
    showState("empty");

    // Pre-fetch Slack users in the background
    loadSlackUsers();

    if (typeof Missive !== "undefined") {
      // Register context-menu action
      registerMissiveActions();

      // Listen for conversation selection changes
      Missive.on("change:conversations", (ids) => {
        handleConversationChange(ids);
      });
    } else {
      console.warn(
        "Missive SDK not detected — running in standalone/dev mode."
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
