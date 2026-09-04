import base64
import io
import logging
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

SUPPORTED_IMAGE_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}
VALID_HTTP_SCHEMES = ("http://", "https://")


def _is_supported_match(*, detected_format: str, declared_mime: str) -> bool:
    """Check if detected image format is supported and matches declared MIME."""
    normalized_declared = (
        "image/jpeg" if declared_mime == "image/jpg" else declared_mime
    )
    expected_mime = f"image/{detected_format.lower()}"
    if expected_mime == "image/jpg":
        expected_mime = "image/jpeg"

    is_supported = detected_format in SUPPORTED_IMAGE_FORMATS
    return is_supported and normalized_declared == expected_mime


def _convert_to_jpeg_b64(*, im: Image.Image) -> str:
    """Convert any Pillow image to a clean base64 data-URI JPEG."""
    export_im: Image.Image = im
    if export_im.mode in ("RGBA", "P", "LA"):
        export_im = export_im.convert("RGB")

    out = io.BytesIO()
    export_im.save(out, format="JPEG", quality=85)
    encoded = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _process_image_data_uri(*, trimmed: str) -> str | None:
    """Safely parse base64 data and re-encode to JPEG if necessary."""
    try:
        header, _, b64_data = trimmed.partition(",")
        if not b64_data:
            return None

        raw_bytes = base64.b64decode(b64_data)
        if not raw_bytes:
            return None

        with Image.open(io.BytesIO(raw_bytes)) as im:
            detected_fmt = (im.format or "").upper()
            declared_mime = header.split(";")[0].replace("data:", "").strip().lower()

            if _is_supported_match(
                detected_format=detected_fmt, declared_mime=declared_mime
            ):
                return trimmed

            logger.info(
                "Auto-converting image to JPEG for LLM compatibility (detected=%s, declared=%s)",
                detected_fmt,
                declared_mime,
            )
            return _convert_to_jpeg_b64(im=im)
    except Exception as exc:
        logger.warning("Failed to parse or convert image data URL: %s", exc)
        return None


def normalize_image_url(*, url: Any) -> str | None:
    """Validate, normalize, and auto-convert image URLs/data-URIs for LLM vision models.

    OpenAI vision endpoints only support: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].
    If an image is in another format (like AVIF, HEIC, TIFF, BMP) or has mismatched MIME headers,
    Pillow is used to safely convert it to JPEG. Corrupted data returns None.
    """
    if not isinstance(url, str):
        return None
    trimmed = url.strip()
    if not trimmed:
        return None

    if any(trimmed.startswith(scheme) for scheme in VALID_HTTP_SCHEMES):
        return trimmed

    if not trimmed.startswith("data:image/"):
        return None

    return _process_image_data_uri(trimmed=trimmed)


def sanitize_image_urls(*, images: list[str] | None) -> list[str]:
    """Filter, sanitize, and convert valid image URLs or data URLs."""
    if not images:
        return []
    clean: list[str] = []
    for img in images:
        normalized = normalize_image_url(url=img)
        if normalized:
            clean.append(normalized)
    return clean
