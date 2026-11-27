// Khi chạy trên máy cá nhân giữ nguyên địa chỉ localhost dưới đây.
// Sau này deploy Backend lên Render xong, chỉ cần thay bằng URL Render (VD: https://ten-app.onrender.com/api/chat)
const API_URL = "https://bookstore-rag-web.onrender.com/api/chat";

const chatToggleBtn = document.getElementById("chat-toggle-btn");
const chatCloseBtn = document.getElementById("chat-close-btn");
const chatWidget = document.getElementById("chat-widget");
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const searchInput = document.getElementById("book-search");
const authorSearchInput = document.getElementById("author-search");
const categoryFilter = document.getElementById("category-filter");
const editionFilter = document.getElementById("edition-filter");
const stockFilter = document.getElementById("stock-filter");
const sortSelect = document.getElementById("sort-books");
const bookGrid = document.querySelector(".book-grid");
const bookCards = Array.from(document.querySelectorAll(".book-card"));
const resultsCount = document.getElementById("results-count");
const noResults = document.getElementById("no-results");
const catalogTitle = document.querySelector(".section-title");
const navCategoryLinks = Array.from(document.querySelectorAll(".nav-links a[data-category]"));
const categoryTitles = {
  all: "Sách Nổi Bật Tại Cửa Hàng",
  "manga-lightnovel": "Manga & Light Novel",
  detective: "Tiểu Thuyết Trinh Thám",
  boxset: "Boxset Đặc Biệt"
};

const cartToggleBtn = document.getElementById("cart-toggle-btn");
const cartCloseBtn = document.getElementById("cart-close-btn");
const cartPanel = document.getElementById("cart-panel");
const cartBackdrop = document.getElementById("cart-backdrop");
const cartItems = document.getElementById("cart-items");
const cartCount = document.getElementById("cart-count");
const cartTotal = document.getElementById("cart-total");
const clearCartBtn = document.getElementById("clear-cart-btn");
const placeOrderBtn = document.getElementById("place-order-btn");
const cartStatus = document.getElementById("cart-status");
const accountToggleBtn = document.getElementById("account-toggle-btn");
const accountBackdrop = document.getElementById("account-backdrop");
const accountCloseBtn = document.getElementById("account-close-btn");
const accountMessage = document.getElementById("account-message");
const authForms = document.getElementById("auth-forms");
const signInForm = document.getElementById("sign-in-form");
const signUpForm = document.getElementById("sign-up-form");
const showSignUpBtn = document.getElementById("show-sign-up-btn");
const showSignInBtn = document.getElementById("show-sign-in-btn");
const accountDetails = document.getElementById("account-details");
const profileForm = document.getElementById("profile-form");
const orderHistoryList = document.getElementById("order-history-list");
const signOutBtn = document.getElementById("sign-out-btn");

const books = bookCards.map((card, index) => ({
  id: card.dataset.id,
  title: card.querySelector("h3").textContent.trim(),
  author: card.querySelector(".author").textContent.trim(),
  category: card.dataset.category,
  edition: card.dataset.edition.split(/\s+/),
  price: Number(card.dataset.price),
  inStock: card.dataset.stock === "true",
  index
}));
const booksById = new Map(books.map((book) => [book.id, book]));
const money = new Intl.NumberFormat("vi-VN");
let cart = loadCart();
let currentUser = null;
let cartSyncQueue = Promise.resolve();
const supabaseConfig = window.SUPABASE_CONFIG;
const supabaseClient = window.supabase && supabaseConfig
  ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
  : null;

chatToggleBtn.addEventListener("click", () => {
  chatWidget.classList.toggle("hidden");
});

chatCloseBtn.addEventListener("click", () => {
  chatWidget.classList.add("hidden");
});

function normalizeText(text, ignoreAccents = true) {
  let normalized = text.normalize("NFC").toLocaleLowerCase("vi");
  if (ignoreAccents) {
    normalized = normalized.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
  }
  return normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const searchStopWords = new Set(["va", "la", "co", "cua", "cho", "tim", "sach", "truyen", "cuon", "quyen", "loai", "nao", "nhe"]);

function isCloseMatch(queryToken, textToken) {
  if (queryToken.length < 4) return queryToken === textToken;
  if (textToken.includes(queryToken)) return true;
  if (Math.abs(queryToken.length - textToken.length) > 1) return false;

  let mismatches = 0;
  let queryIndex = 0;
  let textIndex = 0;
  while (queryIndex < queryToken.length && textIndex < textToken.length) {
    if (queryToken[queryIndex] === textToken[textIndex]) {
      queryIndex += 1;
      textIndex += 1;
      continue;
    }

    mismatches += 1;
    if (mismatches > 1) return false;
    if (queryToken.length > textToken.length) queryIndex += 1;
    else if (queryToken.length < textToken.length) textIndex += 1;
    else {
      queryIndex += 1;
      textIndex += 1;
    }
  }

  return mismatches + (queryToken.length - queryIndex) + (textToken.length - textIndex) <= 1;
}

function filterAndSortBooks() {
  const queryTokens = normalizeText(searchInput.value, false)
    .split(/\s+/)
    .map((raw) => ({ raw, folded: normalizeText(raw) }))
    .filter((token) => token.folded && !searchStopWords.has(token.folded));
  const authorTokens = normalizeText(authorSearchInput.value).split(/\s+/).filter(Boolean);
  const category = categoryFilter.value;
  const searchDocuments = books.map((book) => {
    const titleRawWords = normalizeText(book.title, false).split(/\s+/);
    const titleFoldedWords = normalizeText(book.title).split(/\s+/);
    return {
      book,
      titleRawWords,
      titleFoldedWords,
      titleRawCompact: titleRawWords.join(""),
      titleFoldedCompact: titleFoldedWords.join("")
    };
  });

  function findMatches(ignoreAccents, allowShortPrefix = false) {
    const tokens = queryTokens.map((token) => ignoreAccents ? token.folded : token.raw);
    const documents = searchDocuments.map((document) => ({
      ...document,
      words: ignoreAccents ? document.titleFoldedWords : document.titleRawWords,
      compact: ignoreAccents ? document.titleFoldedCompact : document.titleRawCompact
    }));
    const exactTokens = new Set(tokens.filter((token) =>
      documents.some(({ words, compact }) =>
        words.some((word) => word === token || (token.length >= 4 && word.includes(token)))
        || (tokens.length === 1 && token.length >= 6 && compact.includes(token))
      )
    ));

    return documents.filter(({ book, words, compact }) => {
      const matchesCategory = category === "all"
        || (category === "manga-lightnovel" && ["manga", "lightnovel"].includes(book.category))
        || book.category === category;
      const selectedEdition = editionFilter.value;
      const matchesEdition = selectedEdition === "all" || book.edition.includes(selectedEdition);
      const selectedStock = stockFilter.value;
      const matchesStock = selectedStock === "all"
        || (selectedStock === "in-stock" && book.inStock)
        || (selectedStock === "out-of-stock" && !book.inStock);
      const authorWords = normalizeText(book.author).split(/\s+/);
      const matchesAuthor = authorTokens.every((token) =>
        authorWords.some((word) => word.includes(token))
      );
      const matchesQuery = tokens.every((token) =>
        words.some((word) =>
          word === token
          || (token.length >= 4 && word.includes(token))
          || (allowShortPrefix && token.length >= 1 && word.startsWith(token))
          || (!exactTokens.has(token) && isCloseMatch(token, word))
        )
        || (tokens.length === 1 && token.length >= 6 && compact.includes(token))
      );
      return matchesQuery && matchesCategory && matchesEdition && matchesStock && matchesAuthor;
    }).map(({ book }) => book);
  }

  let matchingBooks = findMatches(false);
  if (matchingBooks.length === 0) {
    matchingBooks = findMatches(true, true);
  }

  matchingBooks.sort((a, b) => {
    if (sortSelect.value === "price-asc") return a.price - b.price;
    if (sortSelect.value === "price-desc") return b.price - a.price;
    if (sortSelect.value === "title-asc") return a.title.localeCompare(b.title, "vi");
    return a.index - b.index;
  });

  const matchingIds = new Set(matchingBooks.map((book) => book.id));
  matchingBooks.forEach((book) => bookGrid.appendChild(bookCards[book.index]));
  books.filter((book) => !matchingIds.has(book.id)).forEach((book) => bookGrid.appendChild(bookCards[book.index]));
  bookCards.forEach((card) => {
    card.hidden = !matchingIds.has(card.dataset.id);
  });

  resultsCount.textContent = `Hiển thị ${matchingBooks.length}/${books.length} sản phẩm`;
  noResults.hidden = matchingBooks.length > 0;
  catalogTitle.textContent = categoryTitles[category] || categoryTitles.all;
  navCategoryLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.category === category);
  });
}

searchInput.addEventListener("input", filterAndSortBooks);
authorSearchInput.addEventListener("input", filterAndSortBooks);
categoryFilter.addEventListener("change", filterAndSortBooks);
editionFilter.addEventListener("change", filterAndSortBooks);
stockFilter.addEventListener("change", filterAndSortBooks);
sortSelect.addEventListener("change", filterAndSortBooks);
navCategoryLinks.forEach((link) => {
  link.addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.value = link.dataset.category;
    filterAndSortBooks();
  });
});
filterAndSortBooks();

function loadCart() {
  try {
    const savedCart = JSON.parse(localStorage.getItem("bookstore-cart") || "[]");
    if (!Array.isArray(savedCart)) throw new TypeError("Dữ liệu giỏ hàng không hợp lệ");
    return savedCart.reduce((items, item) => {
      const book = item && booksById.get(item.id);
      const quantity = Number(item && item.quantity);
      if (book && book.inStock && Number.isSafeInteger(quantity) && quantity > 0) {
        items.set(book.id, quantity);
      }
      return items;
    }, new Map());
  } catch (error) {
    console.error("Không thể đọc giỏ hàng đã lưu:", error);
    return new Map();
  }
}

function saveCart() {
  try {
    if (currentUser) {
      localStorage.removeItem("bookstore-cart");
      queueCartSync();
    } else {
      localStorage.setItem("bookstore-cart", JSON.stringify(
        Array.from(cart, ([id, quantity]) => ({ id, quantity }))
      ));
    }
  } catch (error) {
    console.error("Không thể lưu giỏ hàng:", error);
    window.alert("Không thể lưu giỏ hàng trên thiết bị này. Vui lòng kiểm tra cài đặt trình duyệt.");
  }
}

function setAccountMessage(message, isError = false) {
  accountMessage.textContent = message;
  accountMessage.classList.toggle("error", isError);
}

function setCartStatus(message, isError = false) {
  cartStatus.textContent = message;
  cartStatus.classList.toggle("error", isError);
}

function queueCartSync() {
  if (!supabaseClient || !currentUser) return;
  const userId = currentUser.id;
  const snapshot = Array.from(cart, ([book_id, quantity]) => ({ book_id, quantity }));
  cartSyncQueue = cartSyncQueue.then(async () => {
    if (!currentUser || currentUser.id !== userId) return;
    const { error: deleteError } = await supabaseClient
      .from("cart_items")
      .delete()
      .eq("user_id", userId);
    if (deleteError) throw deleteError;
    if (snapshot.length === 0) return;
    const { error: insertError } = await supabaseClient
      .from("cart_items")
      .upsert(snapshot.map((item) => ({ ...item, user_id: userId })), {
        onConflict: "user_id,book_id"
      });
    if (insertError) throw insertError;
  }).catch((error) => {
    console.error("Không thể đồng bộ giỏ hàng với Supabase:", error);
    setCartStatus("Không thể đồng bộ giỏ hàng lên tài khoản. Vui lòng thử lại.", true);
  });
}

async function restoreAccountCart(userId, guestCart) {
  const { data, error } = await supabaseClient
    .from("cart_items")
    .select("book_id, quantity")
    .eq("user_id", userId);
  if (error) throw error;

  if (data.length > 0) {
    cart = new Map(data
      .filter((item) => booksById.has(item.book_id) && Number.isSafeInteger(item.quantity))
      .map((item) => [item.book_id, item.quantity]));
  } else {
    cart = guestCart;
  }
  renderCart();
  saveCart();
}

async function loadProfile() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("full_name, phone, address")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (error) throw error;
  profileForm.elements.namedItem("full_name").value = data?.full_name || "";
  profileForm.elements.namedItem("phone").value = data?.phone || "";
  profileForm.elements.namedItem("address").value = data?.address || "";
}

async function loadOrderHistory() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("id, status, total, created_at, order_items(title, unit_price, quantity)")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  orderHistoryList.replaceChildren();
  if (data.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-cart";
    empty.textContent = "Bạn chưa có đơn hàng nào.";
    orderHistoryList.appendChild(empty);
    return;
  }

  const statusLabels = {
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    shipped: "Đang giao",
    completed: "Hoàn thành",
    cancelled: "Đã hủy"
  };
  data.forEach((order) => {
    const article = document.createElement("article");
    article.className = "order-history-item";
    const heading = document.createElement("strong");
    heading.textContent = `Đơn ${order.id.slice(0, 8)} · ${statusLabels[order.status] || order.status}`;
    const date = document.createElement("p");
    date.textContent = new Date(order.created_at).toLocaleString("vi-VN");
    const items = document.createElement("ul");
    order.order_items.forEach((orderItem) => {
      const item = document.createElement("li");
      item.textContent = `${orderItem.title} × ${orderItem.quantity} — ${formatPrice(orderItem.unit_price * orderItem.quantity)}`;
      items.appendChild(item);
    });
    const total = document.createElement("strong");
    total.textContent = `Tổng: ${formatPrice(order.total)}`;
    article.append(heading, date, items, total);
    orderHistoryList.appendChild(article);
  });
}

async function handleAuthSession(session) {
  const nextUser = session?.user || null;
  if (currentUser?.id === nextUser?.id) return;

  if (!nextUser) {
    currentUser = null;
    cart = new Map();
    try {
      localStorage.removeItem("bookstore-cart");
    } catch (error) {
      console.error("Không thể xóa giỏ hàng cục bộ:", error);
    }
    accountToggleBtn.textContent = "Đăng nhập";
    authForms.hidden = false;
    accountDetails.hidden = true;
    renderCart();
    return;
  }

  const guestCart = new Map(cart);
  currentUser = nextUser;
  try {
    localStorage.removeItem("bookstore-cart");
  } catch (error) {
    console.error("Không thể xóa giỏ hàng cục bộ sau khi đăng nhập:", error);
  }
  accountToggleBtn.textContent = "Tài khoản";
  authForms.hidden = true;
  accountDetails.hidden = false;
  setAccountMessage(`Đã đăng nhập: ${currentUser.email || ""}`);
  const results = await Promise.allSettled([
    loadProfile(),
    restoreAccountCart(currentUser.id, guestCart),
    loadOrderHistory()
  ]);
  const sections = ["hồ sơ", "giỏ hàng", "lịch sử đơn hàng"];
  const failures = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    console.error(`Không thể tải ${sections[index]} từ Supabase:`, result.reason);
    return [`${sections[index]}: ${result.reason.message || "Lỗi không xác định"}`];
  });
  if (failures.length > 0) {
    setAccountMessage(`Không tải được ${failures.join(" | ")}`, true);
  } else {
    setAccountMessage(`Đã đăng nhập: ${currentUser.email || ""}`);
  }
}

function openAccount() {
  accountBackdrop.hidden = false;
  accountCloseBtn.focus();
}

function closeAccount() {
  accountBackdrop.hidden = true;
  accountToggleBtn.focus();
}

function initializeSupabase() {
  if (!supabaseClient) {
    setAccountMessage("Không tải được Supabase SDK hoặc cấu hình kết nối.");
    return;
  }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      handleAuthSession(session).catch((error) => {
        console.error("Không thể cập nhật phiên đăng nhập:", error);
        setAccountMessage("Không thể tải dữ liệu tài khoản. Vui lòng thử đăng nhập lại.", true);
      });
    }, 0);
  });
  supabaseClient.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    return handleAuthSession(data.session);
  }).catch((error) => {
    console.error("Không thể khôi phục phiên Supabase:", error);
    setAccountMessage("Không thể kiểm tra phiên đăng nhập. Vui lòng tải lại trang.", true);
  });
}

function formatPrice(price) {
  return `${money.format(price)} VNĐ`;
}

function renderCart() {
  const entries = Array.from(cart, ([id, quantity]) => ({ book: booksById.get(id), quantity }))
    .filter((entry) => entry.book);
  const totalQuantity = entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const totalPrice = entries.reduce((sum, entry) => sum + entry.book.price * entry.quantity, 0);

  cartCount.textContent = String(totalQuantity);
  cartToggleBtn.setAttribute("aria-label", `Giỏ hàng, ${totalQuantity} sản phẩm`);
  cartTotal.textContent = formatPrice(totalPrice);
  cartItems.replaceChildren();
  placeOrderBtn.disabled = entries.length === 0;

  if (entries.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "empty-cart";
    emptyMessage.textContent = "Giỏ hàng đang trống. Hãy chọn một cuốn sách bạn yêu thích nhé!";
    cartItems.appendChild(emptyMessage);
  }

  entries.forEach(({ book, quantity }) => {
    const item = document.createElement("article");
    item.className = "cart-item";

    const details = document.createElement("div");
    details.className = "cart-item-details";
    const title = document.createElement("h3");
    title.textContent = book.title;
    const price = document.createElement("p");
    price.textContent = `${formatPrice(book.price)} / cuốn`;
    details.append(title, price);

    const controls = document.createElement("div");
    controls.className = "quantity-controls";
    controls.setAttribute("aria-label", `Số lượng ${book.title}`);
    controls.append(
      createCartAction("−", "decrease", book.id, `Giảm số lượng ${book.title}`),
      Object.assign(document.createElement("span"), { textContent: String(quantity), className: "quantity-value" }),
      createCartAction("+", "increase", book.id, `Tăng số lượng ${book.title}`),
      createCartAction("Xóa", "remove", book.id, `Xóa ${book.title} khỏi giỏ`)
    );
    item.append(details, controls);
    cartItems.appendChild(item);
  });

  clearCartBtn.disabled = entries.length === 0;
}

function createCartAction(label, action, id, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cart-action cart-action-${action}`;
  button.dataset.action = action;
  button.dataset.id = id;
  button.setAttribute("aria-label", ariaLabel);
  button.textContent = label;
  return button;
}

function openCart() {
  cartPanel.classList.add("open");
  cartPanel.setAttribute("aria-hidden", "false");
  cartBackdrop.hidden = false;
  cartToggleBtn.setAttribute("aria-expanded", "true");
  cartCloseBtn.focus();
}

function closeCart() {
  cartPanel.classList.remove("open");
  cartPanel.setAttribute("aria-hidden", "true");
  cartBackdrop.hidden = true;
  cartToggleBtn.setAttribute("aria-expanded", "false");
  cartToggleBtn.focus();
}

cartToggleBtn.addEventListener("click", openCart);
cartCloseBtn.addEventListener("click", closeCart);
cartBackdrop.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartPanel.classList.contains("open")) closeCart();
});

bookGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".add-to-cart");
  if (!button || button.disabled) return;

  const id = button.closest(".book-card").dataset.id;
  if ((cart.get(id) || 0) >= 99) {
    window.alert("Mỗi sản phẩm có thể thêm tối đa 99 cuốn.");
    return;
  }
  cart.set(id, (cart.get(id) || 0) + 1);
  saveCart();
  renderCart();
  const originalLabel = button.textContent;
  button.textContent = "Đã thêm ✓";
  window.setTimeout(() => {
    button.textContent = originalLabel;
  }, 1200);
});

cartItems.addEventListener("click", (event) => {
  const button = event.target.closest(".cart-action");
  if (!button) return;

  const { action, id } = button.dataset;
  const quantity = cart.get(id);
  if (action === "remove" || (action === "decrease" && quantity <= 1)) {
    cart.delete(id);
  } else if (action === "decrease") {
    cart.set(id, quantity - 1);
  } else if (action === "increase") {
    cart.set(id, quantity + 1);
  }
  saveCart();
  renderCart();
});

clearCartBtn.addEventListener("click", () => {
  cart.clear();
  saveCart();
  renderCart();
});

accountToggleBtn.addEventListener("click", openAccount);
accountCloseBtn.addEventListener("click", closeAccount);
accountBackdrop.addEventListener("click", (event) => {
  if (event.target === accountBackdrop) closeAccount();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !accountBackdrop.hidden) closeAccount();
});

showSignUpBtn.addEventListener("click", () => {
  signInForm.hidden = true;
  signUpForm.hidden = false;
  setAccountMessage("");
  signUpForm.elements.namedItem("full_name").focus();
});
showSignInBtn.addEventListener("click", () => {
  signUpForm.hidden = true;
  signInForm.hidden = false;
  setAccountMessage("");
  signInForm.elements.namedItem("email").focus();
});

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const formData = new FormData(signInForm);
  setAccountMessage("Đang đăng nhập...");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (error) {
    setAccountMessage(`Đăng nhập thất bại: ${error.message}`, true);
    return;
  }
  setAccountMessage("Đăng nhập thành công.");
});

signUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) return;
  const formData = new FormData(signUpForm);
  setAccountMessage("Đang tạo tài khoản...");
  const { data, error } = await supabaseClient.auth.signUp({
    email: formData.get("email"),
    password: formData.get("password"),
    options: { data: { full_name: formData.get("full_name").trim() } }
  });
  if (error) {
    setAccountMessage(`Đăng ký thất bại: ${error.message}`, true);
    return;
  }
  if (!data.session) {
    setAccountMessage("Đăng ký thành công. Hãy xác nhận email rồi đăng nhập.");
    signUpForm.reset();
  } else {
    setAccountMessage("Tạo tài khoản thành công.");
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient || !currentUser) return;
  const formData = new FormData(profileForm);
  const profile = {
    id: currentUser.id,
    email: currentUser.email || "",
    full_name: formData.get("full_name").trim(),
    phone: formData.get("phone").trim(),
    address: formData.get("address").trim(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from("profiles").upsert(profile, { onConflict: "id" });
  if (error) {
    console.error("Không thể lưu hồ sơ:", error);
    setAccountMessage(`Không thể lưu hồ sơ: ${error.message}`, true);
    return;
  }
  setAccountMessage("Đã lưu thông tin hồ sơ.");
});

signOutBtn.addEventListener("click", async () => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    setAccountMessage(`Đăng xuất thất bại: ${error.message}`, true);
    return;
  }
  setAccountMessage("Đã đăng xuất.");
});

placeOrderBtn.addEventListener("click", async () => {
  if (!currentUser) {
    openAccount();
    setAccountMessage("Đăng nhập để tạo đơn và lưu lịch sử đơn hàng.");
    return;
  }
  if (cart.size === 0) return;

  const formData = new FormData(profileForm);
  const profile = {
    id: currentUser.id,
    email: currentUser.email || "",
    full_name: formData.get("full_name").trim(),
    phone: formData.get("phone").trim(),
    address: formData.get("address").trim(),
    updated_at: new Date().toISOString()
  };
  if (!profile.full_name || !profile.phone || !profile.address) {
    openAccount();
    setAccountMessage("Hãy điền và lưu đầy đủ thông tin nhận hàng trước khi tạo đơn.", true);
    return;
  }

  placeOrderBtn.disabled = true;
  setCartStatus("Đang tạo đơn hàng...");
  try {
    const { error: profileError } = await supabaseClient
      .from("profiles")
      .upsert(profile, { onConflict: "id" });
    if (profileError) throw profileError;

    const { data: orderId, error: orderError } = await supabaseClient.rpc("place_order", {
      p_full_name: profile.full_name,
      p_phone: profile.phone,
      p_address: profile.address,
      p_items: Array.from(cart, ([book_id, quantity]) => ({ book_id, quantity }))
    });
    if (orderError) throw orderError;

    cart.clear();
    saveCart();
    renderCart();
    setCartStatus(`Đã tạo đơn ${String(orderId).slice(0, 8)}. Cửa hàng sẽ liên hệ xác nhận.`);
    try {
      await loadOrderHistory();
    } catch (historyError) {
      console.error("Đơn đã tạo nhưng không thể tải lại lịch sử:", historyError);
      setCartStatus("Đơn đã tạo nhưng không tải được lịch sử. Hãy mở lại tài khoản để thử lại.", true);
    }
  } catch (error) {
    console.error("Không thể tạo đơn hàng:", error);
    setCartStatus(`Không thể tạo đơn hàng: ${error.message}`, true);
  } finally {
    placeOrderBtn.disabled = cart.size === 0;
  }
});

renderCart();
initializeSupabase();

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
