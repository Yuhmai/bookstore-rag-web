import json
import os
import time
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pinecone import Pinecone, ServerlessSpec

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
INDEX_NAME = "bookstore-index"

def run_ingestion():
    with open("books_catalog.json", "r", encoding="utf-8") as f:
        books = json.load(f)

    vectors_to_upsert = []
    for book in books:
        content_text = (
            f"Tên sách: {book['title']} ({book['original_title']})\n"
            f"Tác giả: {book['author']} | Nhà xuất bản: {book['publisher']}\n"
            f"Thể loại: {book['category']}\n"
            f"Phiên bản & Quà tặng: {book['edition']}\n"
            f"Giá bán: {book['price']:,} VNĐ | Trạng thái kho: {book['stock']}\n"
            f"Tóm tắt nội dung: {book['synopsis']}\n"
            f"Link đặt mua: {book['url']}"
        )

        embedding_res = client.models.embed_content(
            model="gemini-embedding-001",
            contents=content_text,
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        vector_values = embedding_res.embeddings[0].values

        vectors_to_upsert.append((
            book["id"],
            vector_values,
            {
                "text": content_text,
                "title": book["title"],
                "url": book["url"]
            }
        ))
        print(f"Đã mã hóa véc-tơ: {book['title']}")

    index = pc.Index(INDEX_NAME)
    try:
        index.upsert(vectors=vectors_to_upsert)
    except Exception as e:
        if "document schema" in str(e).lower():
            print("Đang tự động chuyển Index sang chuẩn Vector Index (768 chiều)...")
            pc.delete_index(INDEX_NAME)
            time.sleep(3)
            pc.create_index(
                name=INDEX_NAME,
                dimension=768,
                metric="cosine",
                spec=ServerlessSpec(cloud="aws", region="us-east-1")
            )
            while not pc.describe_index(INDEX_NAME).status["ready"]:
                time.sleep(2)
            index = pc.Index(INDEX_NAME)
            index.upsert(vectors=vectors_to_upsert)
        else:
            raise e

    print(f"\n--> Hoàn tất! Đã nạp {len(vectors_to_upsert)} đầu sách lên Pinecone Cloud.")

if __name__ == "__main__":
    run_ingestion()