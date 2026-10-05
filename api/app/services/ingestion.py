import ipaddress
import re
import socket
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

MAX_TEXT_CHARS = 60_000
MIN_TEXT_CHARS = 50
ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md"}


class IngestionError(Exception):
    """Raised when source content cannot be safely extracted."""


def extract_text_from_upload(filename: str, data: bytes) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise IngestionError(
            f"Unsupported file type '{ext or '(none)'}'. Allowed: PDF, DOCX, TXT, MD."
        )
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(data))
            text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
        elif ext == ".docx":
            import docx

            document = docx.Document(BytesIO(data))
            text = "\n\n".join(p.text for p in document.paragraphs if p.text.strip())
        else:  # .txt / .md
            text = data.decode("utf-8", errors="replace")
    except IngestionError:
        raise
    except Exception as exc:
        raise IngestionError(f"Could not read file: {exc}") from exc

    text = _clean(text)
    if len(text) < MIN_TEXT_CHARS:
        raise IngestionError("Extracted text is too short to build a learning journey.")
    return text[:MAX_TEXT_CHARS]


def extract_text_from_url(url: str) -> tuple[str, str]:
    """Returns (title, text) for a public URL, with SSRF protections."""
    _assert_safe_url(url)
    try:
        response = httpx.get(
            url,
            timeout=20,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; LearningEngine/0.1; +https://ubl-demo.com)"
            },
        )
    except httpx.HTTPError as exc:
        raise IngestionError(f"Could not fetch URL: {exc}") from exc

    if response.status_code >= 400:
        raise IngestionError(f"URL returned status {response.status_code}")

    content_type = response.headers.get("content-type", "")
    if content_type and "html" not in content_type and "text" not in content_type:
        raise IngestionError(f"Unsupported content type at URL: {content_type}")

    soup = BeautifulSoup(response.text, "html.parser")
    title = url
    if soup.title and soup.title.string:
        title = str(soup.title.string).strip() or url

    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "form", "iframe"]):
        tag.decompose()

    text = _clean(soup.get_text(separator="\n"))
    if len(text) < MIN_TEXT_CHARS:
        raise IngestionError("Page text is too short to build a learning journey.")
    return title[:255], text[:MAX_TEXT_CHARS]


def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise IngestionError("Only http/https URLs are allowed.")
    host = parsed.hostname
    if not host:
        raise IngestionError("Invalid URL.")
    host_lower = host.lower()
    if (
        host_lower == "localhost"
        or host_lower.endswith(".local")
        or host_lower.endswith(".internal")
    ):
        raise IngestionError("Local/internal hosts are not allowed.")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise IngestionError("Could not resolve host.") from exc
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise IngestionError("Access to private networks is not allowed.")


def _clean(text: str) -> str:
    lines = (line.strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def chunk_text(text: str, target_chars: int = 3500) -> list[str]:
    chunks: list[str] = []
    current = ""
    for paragraph in text.split("\n"):
        if len(current) + len(paragraph) + 1 <= target_chars:
            current = f"{current}\n{paragraph}".strip()
        else:
            if current:
                chunks.append(current)
            current = paragraph[:target_chars]
    if current:
        chunks.append(current)
    return chunks


def _normalize(text: str) -> str:
    """Lowercase + collapse all whitespace, for grounding substring checks."""
    return re.sub(r"\s+", " ", text.lower()).strip()
