import os
import traceback
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai import types
from pinecone import Pinecone

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index("bookstore-index")

def get_candidate_models() -> list[str]:
    """Ưu tiên các mô hình Flash-Lite tốc độ cao trên gói Free."""
    candidates = []
    excluded = ("image", "tts", "audio", "live", "embedding", "computer", "robotics", "omni", "deep-research")
    try:
        for m in client.models.list():
            actions = getattr(m, "supported_actions", None) or []
            name = getattr(m, "name", "")
            lower_name = name.lower()
            if "generateContent" in actions and "gemini" in lower_name:
                if not any(kw in lower_name for kw in excluded):
                    candidates.append(name)
    except Exception as e:
        print(f"Cảnh báo khi lấy danh sách model: {e}")

    flash_lite = sorted(
        [n for n in candidates if "flash-lite" in n.lower()],
        reverse=True
    )
    flash_models = sorted(
        [n for n in candidates if "flash" in n.lower() and "lite" not in n.lower()],
        reverse=True
    )
    others = [n for n in candidates if n not in flash_lite and n not in flash_models]
    ordered = ["models/gemini-flash-lite-latest"] + flash_lite + ["models/gemini-flash-latest"] + flash_models + others
    return list(dict.fromkeys(ordered))

CANDIDATE_MODELS = get_candidate_models()
ACTIVE_MODEL: str | None = None
RESPONSE_CACHE: dict[str, str] = {}

print(f"--> Danh sách mô hình ưu tiên tốc độ: {CANDIDATE_MODELS[:5]}")

app = FastAPI(title="Bookstore AI Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    message: str

SYSTEM_PROMPT = """
Bạn là "Thủ thư AI" - trợ lý tư vấn bán hàng chuyên nghiệp, thân thiện của Nhà sách.
Quy tắc trả lời bắt buộc:
1. Chỉ sử dụng thông tin sách trong phần DỮ LIỆU KHO SÁCH bên dưới. Không tự bịa thông tin.
2. Chỉ tập trung giới thiệu cuốn sách khớp nhất với nhu cầu khách hỏi (không liệt kê lan man các sách không liên quan).
3. Trình bày súc tích, gọn gàng bằng gạch đầu dòng và in đậm: **Tên sách**, **Tác giả**, **NXB**, **Giá bán**, **Quà tặng kèm**, **Trạng thái kho**, tóm tắt 1–2 câu hấp dẫn và link: [Đặt mua tại đây](link_san_pham).
4. Nếu sách khách hỏi "Tạm hết hàng" hoặc không có, hãy báo ngắn gọn và gợi ý 1 cuốn khác phù hợp.
"""

def generate_fast_reply(model_name: str, prompt: str) -> str:
    """Gọi Gemini với cấu hình tắt suy luận thừa để tối ưu độ trễ."""
    try:
        res = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                temperature=0.3,
            )
        )
        return res.text
    except Exception as e:
        if "400" in str(e) or "INVALID_ARGUMENT" in str(e):
            res = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0.3)
            )
            return res.text
        raise e

@app.get("/")
def health_check():
    return {"status": "OK", "message": "Backend Chatbot Bán Sách đã sẵn sàng hoạt động!"}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    global ACTIVE_MODEL
    clean_msg = req.message.strip()
    if not clean_msg:
        raise HTTPException(status_code=400, detail="Nội dung tin nhắn không được để trống.")

    # Phản hồi tức thì (< 0.05s) nếu câu hỏi đã có trong bộ nhớ đệm
    cache_key = clean_msg.lower()
    if cache_key in RESPONSE_CACHE:
        return {"reply": RESPONSE_CACHE[cache_key]}

    try:
        # Bước 1: Chuyển câu hỏi thành véc-tơ 768 chiều
        emb_res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=clean_msg,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        q_emb = emb_res.embeddings[0].values

        # Bước 2: Lấy Top 2 cuốn sách sát nhất trên Pinecone
        search_res = index.query(vector=q_emb, top_k=2, include_metadata=True)
        matches = getattr(search_res, "matches", None) or search_res.get("matches", [])

        retrieved_docs = []
        for match in matches:
            meta = getattr(match, "metadata", None) or match.get("metadata", {})
            if "text" in meta:
                retrieved_docs.append(meta["text"])

        context = "\n\n---\n\n".join(retrieved_docs)

        # Bước 3: Ưu tiên gọi thẳng mô hình đang hoạt động tốt nhất
        full_prompt = (
            f"{SYSTEM_PROMPT}\n\n"
            f"=== DỮ LIỆU KHO SÁCH ===\n{context}\n\n"
            f"=== CÂU HỎI KHÁCH HÀNG ===\n{clean_msg}"
        )

        models_to_try = (
            [ACTIVE_MODEL] + [m for m in CANDIDATE_MODELS if m != ACTIVE_MODEL]
            if ACTIVE_MODEL else CANDIDATE_MODELS
        )

        last_error = None
        for model_name in models_to_try:
            try:
                reply_text = generate_fast_reply(model_name, full_prompt)
                ACTIVE_MODEL = model_name
                RESPONSE_CACHE[cache_key] = reply_text
                print(f"--> Trả lời bằng mô hình: {model_name}")
                return {"reply": reply_text}
            except Exception as model_err:
                last_error = model_err
                err_str = str(model_err)
                if any(code in err_str for code in ("404", "NOT_FOUND", "429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE")):
                    continue
                raise model_err

        raise last_error

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý hệ thống: {str(e)}")
