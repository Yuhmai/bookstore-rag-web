// Khi chạy trên máy cá nhân giữ nguyên địa chỉ localhost dưới đây.
// Sau này deploy Backend lên Render xong, chỉ cần thay bằng URL Render (VD: https://ten-app.onrender.com/api/chat)
const API_URL = "http://127.0.0.1:8000/api/chat";

const chatToggleBtn = document.getElementById("chat-toggle-btn");
const chatCloseBtn = document.getElementById("chat-close-btn");
const chatWidget = document.getElementById("chat-widget");
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

// Bật/tắt khung chat (mặc định mở sẵn khi mới vào để dễ kiểm thử)
chatWidget.classList.remove("hidden");

chatToggleBtn.addEventListener("click", () => {
  chatWidget.classList.toggle("hidden");
});

chatCloseBtn.addEventListener("click", () => {
  chatWidget.classList.add("hidden");
});

// Chuyển đổi định dạng Markdown cơ bản của Gemini sang HTML đẹp mắt
function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, "<br>");
}

function appendMessage(sender, htmlContent) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${sender}`;
  msgDiv.innerHTML = htmlContent;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgDiv;
}

async function sendMessage(customText = null) {
  const text = (customText || userInput.value).trim();
  if (!text) return;

  appendMessage("user", text);
  if (!customText) userInput.value = "";

  const loadingMsg = appendMessage("bot", "<em>Thủ thư AI đang tra cứu kho sách...</em>");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text })
    });

    if (!response.ok) {
      throw new Error(`Lỗi kết nối máy chủ (${response.status})`);
    }

    const data = await response.json();
    loadingMsg.innerHTML = formatMarkdown(data.reply);
  } catch (error) {
    loadingMsg.innerHTML = `⚠️ Không thể kết nối tới Backend. Hãy kiểm tra xem <code>uvicorn</code> đã chạy chưa nhé!`;
  }
}

function sendQuickPrompt(promptText) {
  sendMessage(promptText);
}

sendBtn.addEventListener("click", () => sendMessage());
userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});