import os
import traceback
from typing import List
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from pinecone import Pinecone
from supabase import create_client, Client

load_dotenv()

# Khởi tạo Gemini, Pinecone và Supabase
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index("bookstore-index")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
supabase: Client = (
    create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    if SUPABASE_URL and SUPABASE_SERVICE_KEY
    else None
)

# Cấu hình tài khoản nhận VietQR (có thể thay bằng số tài khoản thật của bạn)
BANK_ID = "MB"
ACCOUNT_NO = "0123456789"
ACCOUNT_NAME = "NGUYEN TRUNG HUY"

app = FastAPI(title="Yuhmai BookStore RAG & E-Commerce API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RESPONSE_CACHE = {}

SYSTEM_PROMPT = """Bạn là Thủ thư AI thân thiện, am hiểu manga, light novel và tiểu thuyết của cửa hàng Yuhmai BookStore.
Quy tắc bắt buộc:
1. Chỉ tư vấn dựa trên thông tin sách được cung cấp trong phần NGỮ CẢNH KHO SÁCH bên dưới. Tuyệt đối không tự bịa giá bán, quà tặng hoặc đầu sách không có trong dữ liệu.
2. Nếu sách có trạng thái 'Tạm hết hàng', phải báo rõ cho khách và gợi ý sách khác đang còn hàng nếu có.
3. Trình bày ngắn gọn, rõ ràng bằng tiếng Việt, có gạch đầu dòng tên sách, tác giả, giá bán, quà tặng kèm và đường dẫn đặt mua."""


class ChatRequest(BaseModel):
    message: str


class CartItemInput(BaseModel):
    book_id: str
    quantity: int


class OrderCreateRequest(BaseModel):
    customer_name: str
    phone: str
    address: str
    payment_method: str
    items: List[CartItemInput]


def get_candidate_models() -> list[str]:
    candidates = []
    excluded = ("image", "tts", "audio", "live", "embedding", "computer", "robotics", "omni", "deep-research")
    try:
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            name = getattr(m, "name", "")
            if "generateContent" in actions and "gemini" in name:
                short_name = name.replace("models/", "")
                if not any(x in short_name for x in excluded):
                    candidates.append(short_name)
    except Exception:
        pass

    priority = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-2.5-flash"]
    ordered = [m for m in priority if m in candidates]
    for m in candidates:
        if m not in ordered:
            ordered.append(m)
    return ordered or priority


def verify_user(authorization: str = Header(None)):
    if not supabase:
        raise HTTPException(status_code=500, detail="Chưa cấu hình Supabase trên máy chủ")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để thực hiện")
    token = authorization.split(" ")[1]
    try:
        res = supabase.auth.get_user(token)
        if not res or not res.user:
            raise HTTPException(status_code=401, detail="Phiên đăng nhập hết hạn")
        return res.user
    except Exception:
        raise HTTPException(status_code=401, detail="Xác thực tài khoản thất bại")


@app.get("/")
def health_check():
    return {"status": "ok", "service": "Yuhmai BookStore API"}


@app.post("/api/chat")
def chat_endpoint(req: ChatRequest):
    user_msg = req.message.strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="Câu hỏi không được để trống")

    cache_key = user_msg.lower()
    if cache_key in RESPONSE_CACHE:
        return {"reply": RESPONSE_CACHE[cache_key], "cached": True}

    try:
        # 1. Tạo véc-tơ 768 chiều từ câu hỏi
        emb_res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=user_msg,
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        query_vector = emb_res.embeddings[0].values

        # 2. Truy vấn Pinecone Top-3
        search_res = index.query(vector=query_vector, top_k=3, include_metadata=True)
        matches = search_res.get("matches", [])

        context_blocks = []
        for idx, m in enumerate(matches, 1):
            meta = m.get("metadata", {})
            context_blocks.append(f"[Sách {idx}]\n{meta.get('text', '')}\nLink đặt mua: {meta.get('url', '')}")
        context_text = "\n\n".join(context_blocks) if context_blocks else "Không tìm thấy sách phù hợp trong kho."

        prompt = f"NGỮ CẢNH KHO SÁCH:\n{context_text}\n\nCÂU HỎI KHÁCH HÀNG: {user_msg}"

        # 3. Gọi mô hình sinh câu trả lời với cơ chế Fallback
        last_error = None
        for model_name in get_candidate_models():
            try:
                gen_res = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.2,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                reply_text = gen_res.text
                RESPONSE_CACHE[cache_key] = reply_text
                return {"reply": reply_text, "model": model_name}
            except Exception as e:
                last_error = e
                continue

        raise HTTPException(status_code=503, detail=f"Các mô hình AI đang quá tải: {last_error}")
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/books")
def list_books():
    if not supabase:
        return []
    res = supabase.table("books").select("*").order("id").execute()
    return res.data


@app.post("/api/orders")
def create_order(payload: OrderCreateRequest, authorization: str = Header(None)):
    user = verify_user(authorization)
    if not payload.items:
        raise HTTPException(status_code=400, detail="Giỏ hàng đang trống")

    total_amount = 0
    validated_items = []

    for item in payload.items:
        if item.quantity <= 0:
            continue
        book_res = supabase.table("books").select("*").eq("id", item.book_id).single().execute()
        book = book_res.data
        if not book:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy sách {item.book_id}")
        if book["stock_quantity"] < item.quantity:
            raise HTTPException(status_code=400, detail=f"Sách '{book['title']}' chỉ còn {book['stock_quantity']} cuốn")

        total_amount += book["price"] * item.quantity
        validated_items.append({"book": book, "quantity": item.quantity, "unit_price": book["price"]})

    order_res = supabase.table("orders").insert({
        "user_id": user.id,
        "customer_name": payload.customer_name,
        "phone": payload.phone,
        "address": payload.address,
        "payment_method": payload.payment_method,
        "payment_status": "PENDING",
        "total_amount": total_amount,
    }).execute()
    order_id = order_res.data[0]["id"]

    for vi in validated_items:
        b = vi["book"]
        supabase.table("order_items").insert({
            "order_id": order_id,
            "book_id": b["id"],
            "book_title": b["title"],
            "quantity": vi["quantity"],
            "unit_price": vi["unit_price"],
        }).execute()
        supabase.table("books").update({"stock_quantity": b["stock_quantity"] - vi["quantity"]}).eq("id", b["id"]).execute()

    short_code = order_id.split("-")[0].upper()
    qr_url = None
    if payload.payment_method == "VIETQR":
        qr_url = (
            f"https://img.vietqr.io/image/{BANK_ID}-{ACCOUNT_NO}-compact2.png"
            f"?amount={total_amount}&addInfo=YUHMAI%20{short_code}&accountName={ACCOUNT_NAME.replace(' ', '%20')}"
        )

    return {
        "order_id": order_id,
        "short_code": short_code,
        "total_amount": total_amount,
        "payment_method": payload.payment_method,
        "qr_url": qr_url,
    }


@app.get("/api/orders/me")
def get_my_orders(authorization: str = Header(None)):
    user = verify_user(authorization)
    res = (
        supabase.table("orders")
        .select("*, order_items(*)")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data
