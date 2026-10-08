import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, RESTAURANT } from "./config.js";

const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.includes("PASTE_");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = new Intl.NumberFormat(RESTAURANT.locale, { style: "currency", currency: RESTAURANT.currency });
let products = [], categories = ["Everything"], activeCategory = "all", cart = readCart(), session = null, profile = null, authMode = "signin", adminTab = "orders", toastTimer, deliveryFee = 0;

function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem("epicure-cart") || "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter(item => item && typeof item.id === "string" && /^[0-9a-f-]{36}$/i.test(item.id) && typeof item.name === "string" && Number.isFinite(Number(item.price)) && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0).slice(0, 50).map(item => ({ id: item.id, name: item.name, price: Number(item.price), quantity: Number(item.quantity) }));
  } catch { return []; }
}
function saveCart() { localStorage.setItem("epicure-cart", JSON.stringify(cart)); updateBag(); }
function money(value) { return currency.format(Number(value || 0)); }
function showToast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove("show"), 2800); }
function setMessage(selector, message, error = false) { const node = $(selector); if (node) { node.textContent = message; node.classList.toggle("error", error); } }
function openDialog(id) { const dialog = document.getElementById(id); if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { document.getElementById(id)?.close(); }
function initials(name = "Pizza") { return name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase(); }

function setRestaurantInfo() {
  document.title = `${RESTAURANT.name} — A slice above`;
  $("#restaurantAddress").textContent = RESTAURANT.address;
  $("#openingHours").textContent = RESTAURANT.hours;
  if (RESTAURANT.phone) { $("#restaurantPhone").textContent = RESTAURANT.phone; $("#restaurantPhone").href = `tel:${RESTAURANT.phone.replace(/[^+\d]/g, "")}`; }
  $("#year").textContent = new Date().getFullYear();
}
function updateBag() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  $("#bagCount").textContent = count;
  $("#cartContents").innerHTML = count ? `<div class="cart-lines">${cart.map(item => `<div class="cart-line"><div class="mini-pie">${escapeHtml(initials(item.name))}</div><div class="cart-item-name"><b>${escapeHtml(item.name)}</b><small>${money(item.price)} each</small></div><div class="quantity"><button data-qty="${escapeHtml(item.id)}" data-delta="-1" aria-label="Remove one">−</button><span>${item.quantity}</span><button data-qty="${escapeHtml(item.id)}" data-delta="1" aria-label="Add one">+</button></div><b>${money(item.price * item.quantity)}</b></div>`).join("")}</div><div class="cart-subtotal"><span>Subtotal</span><b>${money(cart.reduce((sum, item) => sum + item.price * item.quantity, 0))}</b></div>` : `<div class="empty-state"><span>🍕</span><h3>Your bag is taking a little nap.</h3><p>Add a favourite and we’ll get the oven going.</p><button class="button primary" data-close="cartDialog">See the menu</button></div>`;
  const hasItems = count > 0;
  $("#checkoutForm").classList.toggle("hidden", !hasItems);
  const fulfillment = new FormData($("#checkoutForm")).get("fulfillment") || "pickup";
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const fee = fulfillment === "delivery" ? deliveryFee : 0;
  const total = subtotal + fee;
  const subtotalNode = $(".cart-subtotal");
  if (subtotalNode && fee > 0) { subtotalNode.classList.add("with-delivery"); subtotalNode.innerHTML = `<div><span>Subtotal</span><b>${money(subtotal)}</b></div><div><span>Delivery</span><b>${money(fee)}</b></div><div class="cart-total"><span>Total</span><b>${money(total)}</b></div>`; }
  else if (subtotalNode) { subtotalNode.classList.remove("with-delivery"); subtotalNode.innerHTML = `<span>Subtotal</span><b>${money(subtotal)}</b>`; }
  $("#checkoutTotal").textContent = money(total);
}
function escapeHtml(value = "") { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function renderCategories() {
  $("#categories").innerHTML = ["Everything", ...categories.filter(item => item.toLowerCase() !== "everything")].map(category => `<button class="category ${activeCategory === (category === "Everything" ? "all" : category) ? "active" : ""}" data-category="${escapeHtml(category === "Everything" ? "all" : category)}">${escapeHtml(category)}</button>`).join("");
}
function renderMenu() {
  const search = $("#menuSearch").value.trim().toLowerCase();
  const visible = products.filter(product => product.is_available && (activeCategory === "all" || product.category === activeCategory) && `${product.name} ${product.description || ""} ${product.category}`.toLowerCase().includes(search));
  $("#menuGrid").innerHTML = visible.length ? visible.map((product, index) => `<article class="dish"><div class="dish-art art-${index % 4}">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">` : `<div class="pie"><i>✦</i><i>✦</i><i>✦</i></div>`}<span class="dish-category">${escapeHtml(product.category)}</span></div><div class="dish-info"><div class="dish-title"><h3>${escapeHtml(product.name)}</h3><b>${money(product.price)}</b></div><p>${escapeHtml(product.description || "Made fresh, just for you.")}</p><button class="add-button" data-add="${product.id}">Add to bag <span>＋</span></button></div></article>`).join("") : `<div class="empty-state"><h3>No slices found.</h3><p>Try another search or category.</p></div>`;
}
async function loadMenu() {
  if (!supabase) { $("#menuGrid").innerHTML = `<div class="setup-state"><b>One quick setup step</b><p>Add your Supabase URL and public anon key in <code>config.js</code>, then apply <code>supabase.sql</code> to load and manage the menu.</p></div>`; return; }
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.from("products").select("id,name,description,category,price,image_url,is_available").eq("is_available", true).order("sort_order").order("name"),
    supabase.from("restaurant_settings").select("delivery_fee").eq("id", 1).maybeSingle(),
  ]);
  deliveryFee = Number(settings?.delivery_fee || 0);
  if (error) { $("#menuGrid").innerHTML = `<div class="setup-state"><b>Menu could not load</b><p>${escapeHtml(error.message)}</p></div>`; return; }
  products = data || [];
  const availableById = new Map(products.map(product => [product.id, product]));
  cart = cart.flatMap(item => { const product = availableById.get(item.id); return product ? [{ ...item, name: product.name, price: Number(product.price) }] : []; });
  saveCart();
  categories = [...new Set(products.map(product => product.category).filter(Boolean))];
  renderCategories(); renderMenu();
}
async function refreshProfile() {
  if (!supabase || !session) { profile = null; updateAccountUI(); return; }
  const { data } = await supabase.from("profiles").select("id,full_name,role").eq("id", session.user.id).maybeSingle();
  profile = data; updateAccountUI();
}
function updateAccountUI() {
  const signedIn = Boolean(session);
  $("#accountButton").textContent = signedIn ? (profile?.full_name?.split(" ")[0] || "Account") : "Sign in";
  $("#signedOutPanel").classList.toggle("hidden", signedIn);
  $("#signedInPanel").classList.toggle("hidden", !signedIn);
  if (signedIn) {
    $("#accountTitle").textContent = `Hello, ${(profile?.full_name || session.user.email.split("@")[0]).split(" ")[0]}.`;
    $("#welcomeLine").textContent = `Signed in as ${session.user.email}`;
    $("#adminLink").classList.toggle("hidden", !["admin", "super_admin"].includes(profile?.role));
    $$(".super-only").forEach(node => node.classList.toggle("hidden", profile?.role !== "super_admin"));
  } else { $("#accountTitle").textContent = "Welcome back."; }
}
function openAccount() { openDialog("accountDialog"); if (session) { updateAccountUI(); } }
function chooseAuthMode(mode) {
  authMode = mode;
  $$("[data-auth-mode]").forEach(button => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#nameField").classList.toggle("hidden", mode !== "signup");
  $("#nameField input").required = mode === "signup";
  $("#authSubmit").textContent = mode === "signup" ? "Create account" : "Sign in";
  $("#authForm [name=password]").autocomplete = mode === "signup" ? "new-password" : "current-password";
  setMessage("#authMessage", "");
}
async function handleAuth(event) {
  event.preventDefault(); if (!supabase) return setMessage("#authMessage", "Add Supabase settings in config.js first.", true);
  const data = new FormData(event.currentTarget), email = data.get("email"), password = data.get("password");
  const result = authMode === "signup" ? await supabase.auth.signUp({ email, password, options: { data: { full_name: data.get("name") } } }) : await supabase.auth.signInWithPassword({ email, password });
  if (result.error) return setMessage("#authMessage", result.error.message, true);
  event.currentTarget.reset();
  if (authMode === "signup" && !result.data.session) setMessage("#authMessage", "Account created. Check your email to confirm, then sign in.");
  else { session = result.data.session; await refreshProfile(); closeDialog("accountDialog"); showToast(authMode === "signup" ? "Your account is ready." : "Welcome back."); }
}
async function loadCustomerOrders() {
  if (!session) return;
  const node = $("#customerOrders"); node.innerHTML = `<h3>Your recent orders</h3><div class="loading">Looking up your orders…</div>`;
  const { data, error } = await supabase.from("orders").select("id,created_at,status,fulfillment,total,order_items(name,quantity)").order("created_at", { ascending: false }).limit(15);
  if (error) { node.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`; return; }
  node.innerHTML = `<h3>Your recent orders</h3>${data?.length ? data.map(order => `<div class="order-card"><div><b>Order #${order.id.slice(0, 8).toUpperCase()}</b><small>${new Date(order.created_at).toLocaleString()}</small><small>${(order.order_items || []).map(item => `${item.quantity}× ${escapeHtml(item.name)}`).join(" · ")}</small></div><div><span class="status status-${order.status}">${escapeHtml(order.status.replaceAll("_", " "))}</span><b>${money(order.total)}</b></div></div>`).join("") : `<p>You haven’t placed an order yet. The first pizza is on you.</p>`}`;
}
async function submitOrder(event) {
  event.preventDefault(); if (!session) { closeDialog("cartDialog"); openAccount(); return showToast("Sign in or create an account to place your order."); }
  if (!cart.length) return;
  const form = new FormData(event.currentTarget), fulfillment = form.get("fulfillment");
  setMessage("#checkoutMessage", "Sending your order to the kitchen…");
  const { data, error } = await supabase.rpc("create_order", { p_fulfillment: fulfillment, p_customer_name: form.get("customer_name"), p_phone: form.get("phone"), p_address: fulfillment === "delivery" ? form.get("address") : null, p_notes: form.get("notes"), p_items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })) });
  if (error) return setMessage("#checkoutMessage", error.message, true);
  cart = []; saveCart(); event.currentTarget.reset(); closeDialog("cartDialog"); openAccount(); await loadCustomerOrders(); showToast(`Order ${String(data).slice(0, 8).toUpperCase()} placed. See you soon!`);
}
async function loadAdmin() {
  if (!session || !["admin", "super_admin"].includes(profile?.role)) return;
  const node = $("#adminContent"); node.innerHTML = `<div class="loading">Loading the kitchen…</div>`;
  if (adminTab === "orders") {
    const { data, error } = await supabase.from("orders").select("id,created_at,status,fulfillment,customer_name,phone,address,total,notes,order_items(name,quantity,unit_price)").order("created_at", { ascending: false }).limit(80);
    if (error) return node.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    node.innerHTML = `<div class="admin-summary"><b>${data.length} recent orders</b><span>Live order queue</span></div><div class="admin-orders">${data.length ? data.map(order => `<article class="admin-order"><div class="admin-order-head"><div><b>#${order.id.slice(0, 8).toUpperCase()} · ${escapeHtml(order.customer_name)}</b><small>${new Date(order.created_at).toLocaleString()} · ${escapeHtml(order.fulfillment)}</small></div><strong>${money(order.total)}</strong></div><p>${(order.order_items || []).map(item => `${item.quantity}× ${escapeHtml(item.name)} (${money(item.unit_price)})`).join(" · ")}</p>${order.address ? `<small>${escapeHtml(order.address)} · ${escapeHtml(order.phone)}</small>` : `<small>${escapeHtml(order.phone)}</small>`}${order.notes ? `<p class="order-note">Note: ${escapeHtml(order.notes)}</p>` : ""}<div class="status-controls"><span class="status status-${order.status}">${escapeHtml(order.status.replaceAll("_", " "))}</span><select data-status="${order.id}" aria-label="Update order status"><option value="pending" ${order.status === "pending" ? "selected" : ""}>Pending</option><option value="confirmed" ${order.status === "confirmed" ? "selected" : ""}>Confirmed</option><option value="preparing" ${order.status === "preparing" ? "selected" : ""}>Preparing</option><option value="ready" ${order.status === "ready" ? "selected" : ""}>Ready</option><option value="completed" ${order.status === "completed" ? "selected" : ""}>Completed</option><option value="cancelled" ${order.status === "cancelled" ? "selected" : ""}>Cancelled</option></select></div></article>`).join("") : `<div class="empty-state"><h3>No orders yet.</h3><p>New customer orders will appear here.</p></div>`}</div>`;
  } else if (adminTab === "menu") {
    const { data, error } = await supabase.from("products").select("*").order("sort_order").order("name");
    if (error) return node.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    const { data: settings } = await supabase.from("restaurant_settings").select("delivery_fee").eq("id", 1).maybeSingle();
    node.innerHTML = `<form id="settingsForm" class="product-form"><h3>Restaurant settings</h3><div class="product-fields"><label>Delivery fee<input name="delivery_fee" type="number" min="0" step="0.01" value="${Number(settings?.delivery_fee || 0)}" required></label></div><button class="button outline" type="submit">Save settings</button></form><form id="productForm" class="product-form"><h3>Add a menu item</h3><div class="product-fields"><input name="name" placeholder="Item name" required><input name="category" placeholder="Category" required><input name="price" type="number" min="0.01" step="0.01" placeholder="Price" required><input name="image_url" type="url" placeholder="Image URL (optional)"><textarea name="description" placeholder="Description" rows="2"></textarea></div><button class="button primary" type="submit">Add item</button></form><div class="menu-admin-list">${data.map(item => `<div class="menu-admin-row"><div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.category)} · ${money(item.price)}</small></div><label class="switch"><input type="checkbox" data-available="${item.id}" ${item.is_available ? "checked" : ""}><span>${item.is_available ? "Available" : "Hidden"}</span></label><button class="danger-link" data-delete-product="${item.id}">Remove</button></div>`).join("")}</div>`;
  } else if (adminTab === "team" && profile?.role === "super_admin") {
    const { data, error } = await supabase.from("profiles").select("id,full_name,role").order("full_name");
    if (error) return node.innerHTML = `<p class="form-message error">${escapeHtml(error.message)}</p>`;
    node.innerHTML = `<div class="setup-state"><b>Team access</b><p>Only the super-admin can assign or remove staff roles. Customers must create their accounts first.</p></div><div class="menu-admin-list">${data.map(person => `<div class="menu-admin-row"><div><b>${escapeHtml(person.full_name || "Epicure customer")}</b><small>${escapeHtml(person.id)}</small></div><select data-role="${person.id}"><option value="customer" ${person.role === "customer" ? "selected" : ""}>Customer</option><option value="admin" ${person.role === "admin" ? "selected" : ""}>Admin</option><option value="super_admin" ${person.role === "super_admin" ? "selected" : ""}>Super-admin</option></select></div>`).join("")}</div>`;
  }
}
async function updateOrderStatus(id, status) { const { error } = await supabase.from("orders").update({ status }).eq("id", id); if (error) showToast(error.message); else { showToast("Order status updated."); loadAdmin(); } }
async function addProduct(event) { event.preventDefault(); const data = new FormData(event.currentTarget); const record = { name: data.get("name"), category: data.get("category"), price: Number(data.get("price")), image_url: data.get("image_url") || null, description: data.get("description") || "", is_available: true }; const { error } = await supabase.from("products").insert(record); if (error) return showToast(error.message); showToast("Menu item added."); await loadAdmin(); await loadMenu(); }
async function saveSettings(event) { event.preventDefault(); const delivery_fee = Number(new FormData(event.currentTarget).get("delivery_fee")); if (!Number.isFinite(delivery_fee) || delivery_fee < 0) return showToast("Enter a valid delivery fee."); const { error } = await supabase.from("restaurant_settings").update({ delivery_fee }).eq("id", 1); if (error) return showToast(error.message); showToast("Restaurant settings saved."); await loadMenu(); updateBag(); }
async function setAvailability(id, is_available) { const { error } = await supabase.from("products").update({ is_available }).eq("id", id); if (error) showToast(error.message); else { showToast("Menu availability updated."); await loadMenu(); } }
async function deleteProduct(id) { if (!confirm("Remove this menu item? Existing orders keep their item details.")) return; const { error } = await supabase.from("products").delete().eq("id", id); if (error) showToast(error.message); else { showToast("Menu item removed."); await loadAdmin(); await loadMenu(); } }
async function setRole(userId, role) { const { error } = await supabase.rpc("set_user_role", { p_user_id: userId, p_role: role }); if (error) showToast(error.message); else { showToast("Team role updated."); await loadAdmin(); } }

document.addEventListener("click", async event => {
  const category = event.target.closest("[data-category]"); if (category) { activeCategory = category.dataset.category; renderCategories(); renderMenu(); }
  const add = event.target.closest("[data-add]"); if (add) { const product = products.find(item => item.id === add.dataset.add); const line = cart.find(item => item.id === product.id); if (line) line.quantity++; else cart.push({ id: product.id, name: product.name, price: Number(product.price), quantity: 1 }); saveCart(); showToast(`${product.name} added to your bag.`); }
  const quantity = event.target.closest("[data-qty]"); if (quantity) { const item = cart.find(line => line.id === quantity.dataset.qty); item.quantity += Number(quantity.dataset.delta); if (item.quantity <= 0) cart = cart.filter(line => line.id !== item.id); saveCart(); updateBag(); }
  const close = event.target.closest("[data-close]"); if (close) closeDialog(close.dataset.close);
  const authTab = event.target.closest("[data-auth-mode]"); if (authTab) chooseAuthMode(authTab.dataset.authMode);
  const adminTabButton = event.target.closest("[data-admin-tab]"); if (adminTabButton) { adminTab = adminTabButton.dataset.adminTab; $$("[data-admin-tab]").forEach(button => button.classList.toggle("active", button === adminTabButton)); loadAdmin(); }
  const removeProduct = event.target.closest("[data-delete-product]"); if (removeProduct) deleteProduct(removeProduct.dataset.deleteProduct);
});
document.addEventListener("change", event => {
  const orderStatus = event.target.closest("[data-status]"); if (orderStatus) updateOrderStatus(orderStatus.dataset.status, orderStatus.value);
  const availability = event.target.closest("[data-available]"); if (availability) setAvailability(availability.dataset.available, availability.checked);
  const role = event.target.closest("[data-role]"); if (role) setRole(role.dataset.role, role.value);
});
$("#menuSearch").addEventListener("input", renderMenu);
$("#bagButton").addEventListener("click", () => { updateBag(); openDialog("cartDialog"); });
$("#accountButton").addEventListener("click", openAccount);
$("#staffButton").addEventListener("click", () => { if (session && ["admin", "super_admin"].includes(profile?.role)) { adminTab = "orders"; openDialog("adminDialog"); loadAdmin(); } else { openAccount(); showToast("Sign in with an authorized staff account."); } });
$("#adminLink").addEventListener("click", () => { closeDialog("accountDialog"); adminTab = "orders"; $$("[data-admin-tab]").forEach(button => button.classList.toggle("active", button.dataset.adminTab === adminTab)); openDialog("adminDialog"); loadAdmin(); });
$("#authForm").addEventListener("submit", handleAuth);
$("#checkoutForm").addEventListener("submit", submitOrder);
$("#checkoutForm").addEventListener("change", event => { if (event.target.name === "fulfillment") { const delivery = event.target.value === "delivery"; $("#addressField").classList.toggle("hidden", !delivery); $("#addressField input").required = delivery; updateBag(); } });
$("#signoutButton").addEventListener("click", async () => { await supabase.auth.signOut(); session = null; profile = null; updateAccountUI(); closeDialog("accountDialog"); showToast("You’re signed out."); });
$("#ordersButton").addEventListener("click", loadCustomerOrders);
$("#adminContent").addEventListener("submit", event => { if (event.target.id === "productForm") addProduct(event); });
$("#adminContent").addEventListener("submit", event => { if (event.target.id === "settingsForm") saveSettings(event); });
for (const dialog of $$("dialog")) dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });

setRestaurantInfo(); updateBag();
if (configured) {
  const { data } = await supabase.auth.getSession(); session = data.session;
  await refreshProfile();
  supabase.auth.onAuthStateChange((_event, nextSession) => { session = nextSession; setTimeout(refreshProfile, 0); });
  await loadMenu();
} else {
  updateAccountUI();
  $("#categories").innerHTML = `<button class="category active" data-category="all">Everything</button>`;
  $("#accountButton").addEventListener("click", () => showToast("Add Supabase settings to enable customer accounts."));
}
