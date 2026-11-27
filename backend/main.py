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
    """Tự động lấy danh sách các mô hình Gemini hỗ trợ sinh văn bản trên gói Free."""
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

    flash_models = sorted(
        [n for n in candidates if "flash" in n.lower() and "lite" not in n.lower()],
        reverse=True
    )
    flash_lite = sorted(
        [n for n in candidates if "flash-lite" in n.lower()],
        reverse=True
    )
    others = [n for n in candidates if n not in flash_models and n not in flash_lite]
    ordered = ["models/gemini-flash-latest"] + flash_models + flash_lite + others
    return list(dict.fromkeys(ordered))

CANDIDATE_MODELS = get_candidate_models()
print(f"--> Danh sách mô hình ưu tiên: {CANDIDATE_MODELS[:5]}")

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
1. Chỉ sử dụng thông tin sách được cung cấp trong phần DỮ LIỆU KHO SÁCH bên dưới để tư vấn. Tuyệt đối không tự bịa ra sách hoặc giá bán không có trong dữ liệu.
2. Khi giới thiệu sách, hãy nêu rõ: Tên sách, Tác giả, Nhà xuất bản, Giá bán, Phiên bản & Quà tặng kèm, Trạng thái kho và tóm tắt ngắn gọn sức hấp dẫn của truyện.
3. Luôn đính kèm đường link đặt mua dạng Markdown: [Đặt mua tại đây](link_san_pham).
4. Nếu sách khách hỏi đang ở trạng thái "Tạm hết hàng" hoặc không có trong dữ liệu, hãy lịch sự thông báo và gợi ý cuốn khác phù hợp.
5. Trình bày bằng Tiếng Việt tự nhiên, sử dụng gạch đầu dòng và in đậm các thông tin quan trọng cho dễ đọc.
"""

@app.get("/")
def health_check():
    return {"status": "OK", "message": "Backend Chatbot Bán Sách đã sẵn sàng hoạt động!"}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Nội dung tin nhắn không được để trống.")

    try:
        # Bước 1: Chuyển câu hỏi người dùng thành véc-tơ 768 chiều
        emb_res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=req.message,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        q_emb = emb_res.embeddings[0].values

        # Bước 2: Tìm Top 3 cuốn sách liên quan nhất trên Pinecone
        search_res = index.query(vector=q_emb, top_k=3, include_metadata=True)
        matches = getattr(search_res, "matches", None) or search_res.get("matches", [])

        retrieved_docs = []
        for match in matches:
            meta = getattr(match, "metadata", None) or match.get("metadata", {})
            if "text" in meta:
                retrieved_docs.append(meta["text"])

        context = "\n\n---\n\n".join(retrieved_docs)

        # Bước 3: Ghép ngữ cảnh và tự động chọn mô hình có hạn mức Free Tier khả dụng
        full_prompt = (
            f"{SYSTEM_PROMPT}\n\n"
            f"=== DỮ LIỆU KHO SÁCH ===\n{context}\n\n"
            f"=== CÂU HỎI KHÁCH HÀNG ===\n{req.message}"
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