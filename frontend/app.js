const BACKEND_BASE = "https://bookstore-rag-web.onrender.com";
const SUPABASE_URL = "https://aotexuwqlsitvcdndatg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_f5ZBHt3HTCNRMbTVITq4yQ__9jWMG4Y";

// ==================== PHẦN 1: CHATBOT THỦ THƯ AI (RAG) ====================
const chatToggleBtn = document.getElementById("chat-toggle-btn");
const chatCloseBtn = document.getElementById("chat-close-btn");
const chatWidget = document.getElementById("chat-widget");
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

if (chatToggleBtn && chatWidget) {
  chatToggleBtn.addEventListener("click", () => {
    chatWidget.classList.toggle("hidden");
    if (!chatWidget.classList.contains("hidden")) userInput.focus();
  });
}

if (chatCloseBtn && chatWidget) {
  chatCloseBtn.addEventListener("click", () => {
    chatWidget.classList.add("hidden");
  });
}

function formatMarkdown(text) {
  let safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  safe = safe.replace(/^\s*[-*]\s+(.+)$/gm, "• $1");
  safe = safe.replace(/\n/g, "<br/>");
  return safe;
}

function appendMessage(content, sender, isHtml = false) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${sender}`;
  if (isHtml) {
    msgDiv.innerHTML = content;
  } else {
    msgDiv.textContent = content;
  }
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgDiv;
}

async function sendMessage(customText = null) {
  const message = (customText !== null ? customText : userInput.value).trim();
  if (!message) return;

  appendMessage(message, "user");
  if (customText === null) userInput.value = "";
  userInput.disabled = true;
  sendBtn.disabled = true;

  const loadingMsg = appendMessage("Thủ thư AI đang tra cứu kho sách...", "bot");

  try {
    const response = await fetch(`${BACKEND_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Lỗi kết nối máy chủ AI");
    }
    loadingMsg.innerHTML = formatMarkdown(data.reply || "Xin lỗi, mình chưa tìm thấy thông tin phù hợp.");
  } catch (err) {
    loadingMsg.textContent = "Hệ thống đang khởi động hoặc bận, bạn vui lòng thử lại sau vài giây: " + err.message;
  } finally {
    userInput.disabled = false;
    sendBtn.disabled = false;
    userInput.focus();
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function sendQuickPrompt(text) {
  if (chatWidget && chatWidget.classList.contains("hidden")) {
    chatWidget.classList.remove("hidden");
  }
  sendMessage(text);
}

if (sendBtn) sendBtn.addEventListener("click", () => sendMessage());
if (userInput) {
  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

// ==================== PHẦN 2: SUPABASE AUTH, GIỎ HÀNG & THANH TOÁN ====================
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let currentSession = null;
let cart = JSON.parse(localStorage.getItem("yuhmai_cart") || "[]");

async function initAuth() {
  const { data } = await sbClient.auth.getSession();
  updateAuthUI(data.session);
  sbClient.auth.onAuthStateChange((_event, session) => updateAuthUI(session));
}

function updateAuthUI(session) {
  currentSession = session;
  const btnAuth = document.getElementById("btn-auth");
  const userMenu = document.getElementById("user-menu");
  if (!btnAuth || !userMenu) return;

  if (session && session.user) {
    btnAuth.style.display = "none";
    userMenu.style.display = "flex";
    document.getElementById("user-email-label").textContent = session.user.email;
  } else {
    btnAuth.style.display = "inline-block";
    userMenu.style.display = "none";
  }
}

function openAuthModal() {
  document.getElementById("auth-msg").textContent = "";
  document.getElementById("auth-modal").style.display = "flex";
}

function closeModal(id) {
  document.getElementById(id).style.display = "none";
}

async function handleLogin() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const { error } = await sbClient.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById("auth-msg").style.color = "#dc2626";
    document.getElementById("auth-msg").textContent = "Lỗi: " + error.message;
  } else {
    closeModal("auth-modal");
  }
}

async function handleRegister() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const { error } = await sbClient.auth.signUp({ email, password });
  if (error) {
    document.getElementById("auth-msg").style.color = "#dc2626";
    document.getElementById("auth-msg").textContent = "Lỗi đăng ký: " + error.message;
  } else {
    document.getElementById("auth-msg").style.color = "#16a34a";
    document.getElementById("auth-msg").textContent = "Đăng ký thành công! Bạn có thể bấm Đăng nhập.";
  }
}

async function handleLogout() {
  await sbClient.auth.signOut();
}

function saveCart() {
  localStorage.setItem("yuhmai_cart", JSON.stringify(cart));
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
  const badge = document.getElementById("cart-count");
  if (badge) badge.textContent = totalQty;
}

function addToCart(bookId, title, price) {
  const existing = cart.find((i) => i.book_id === bookId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ book_id: bookId, title, price, quantity: 1 });
  }
  saveCart();
  alert(`Đã thêm "${title}" vào giỏ hàng!`);
}

function changeQty(index, delta) {
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) cart.splice(index, 1);
  saveCart();
  renderCart();
}

function openCart() {
  document.getElementById("checkout-form").style.display = "block";
  document.getElementById("order-success-box").style.display = "none";
  renderCart();
  document.getElementById("cart-modal").style.display = "flex";
}

function renderCart() {
  const container = document.getElementById("cart-items-list");
  if (!cart.length) {
    container.innerHTML = "<p style='color:#64748b;'>Giỏ hàng của bạn đang trống.</p>";
    document.getElementById("cart-total").textContent = "0 VNĐ";
    return;
  }
  let total = 0;
  container.innerHTML = cart
    .map((item, idx) => {
      total += item.price * item.quantity;
      return `
        <div class="cart-row">
          <div>
            <strong>${item.title}</strong><br/>
            <span style="color:#64748b;">${item.price.toLocaleString("vi-VN")} VNĐ</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button onclick="changeQty(${idx}, -1)">-</button>
            <span>${item.quantity}</span>
            <button onclick="changeQty(${idx}, 1)">+</button>
          </div>
        </div>`;
    })
    .join("");
  document.getElementById("cart-total").textContent = total.toLocaleString("vi-VN") + " VNĐ";
}

async function submitOrder() {
  if (!currentSession) {
    closeModal("cart-modal");
    openAuthModal();
    document.getElementById("auth-msg").textContent = "Vui lòng đăng nhập trước khi đặt hàng!";
    return;
  }
  if (!cart.length) return alert("Giỏ hàng đang trống!");

  const customer_name = document.getElementById("ship-name").value.trim();
  const phone = document.getElementById("ship-phone").value.trim();
  const address = document.getElementById("ship-address").value.trim();
  const payment_method = document.getElementById("payment-method").value;

  if (!customer_name || !phone || !address) {
    return alert("Vui lòng nhập đầy đủ Họ tên, Số điện thoại và Địa chỉ!");
  }

  const res = await fetch(`${BACKEND_BASE}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentSession.access_token}`
    },
    body: JSON.stringify({
      customer_name,
      phone,
      address,
      payment_method,
      items: cart.map((i) => ({ book_id: i.book_id, quantity: i.quantity }))
    })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.detail || "Đặt hàng thất bại");

  cart = [];
  saveCart();
  document.getElementById("checkout-form").style.display = "none";
  document.getElementById("order-success-box").style.display = "block";
  document.getElementById("res-order-code").textContent = data.short_code;

  const qrBox = document.getElementById("qr-container");
  if (data.qr_url) {
    qrBox.innerHTML = `
      <p style="font-size:13px;">Quét mã VietQR dưới đây để thanh toán <strong>${data.total_amount.toLocaleString("vi-VN")} VNĐ</strong>:</p>
      <img src="${data.qr_url}" alt="VietQR" style="max-width:220px; border:1px solid #e2e8f0; border-radius:8px;" />
    `;
  } else {
    qrBox.innerHTML = `<p style="font-size:13px;">Đơn hàng COD trị giá <strong>${data.total_amount.toLocaleString("vi-VN")} VNĐ</strong> đang chờ xác nhận.</p>`;
  }
}

async function openOrdersModal() {
  if (!currentSession) return;
  document.getElementById("orders-modal").style.display = "flex";
  const box = document.getElementById("orders-list");
  box.innerHTML = "Đang tải đơn hàng...";

  const res = await fetch(`${BACKEND_BASE}/api/orders/me`, {
    headers: { Authorization: `Bearer ${currentSession.access_token}` }
  });
  const orders = await res.json();
  if (!orders.length) {
    box.innerHTML = "<p>Bạn chưa có đơn hàng nào.</p>";
    return;
  }
  box.innerHTML = orders
    .map(
      (o) => `
    <div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:10px; font-size:13px;">
      <div style="display:flex; justify-content:space-between;">
        <strong>Mã đơn: ${o.id.split("-")[0].toUpperCase()}</strong>
        <span style="color:#2563eb; font-weight:600;">${o.payment_method} - ${o.payment_status}</span>
      </div>
      <div style="margin:6px 0; color:#475569;">
        ${o.order_items.map((it) => `• ${it.book_title} (x${it.quantity})`).join("<br/>")}
      </div>
      <div style="text-align:right; font-weight:bold; color:#dc2626;">
        Tổng: ${o.total_amount.toLocaleString("vi-VN")} VNĐ
      </div>
    </div>
  `
    )
    .join("");
}

saveCart();
initAuth();
