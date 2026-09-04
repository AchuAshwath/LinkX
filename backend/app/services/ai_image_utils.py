import base64
import io
import logging
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)

SUPPORTED_IMAGE_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}
VALID_HTTP_SCHEMES = ("http://", "https://")


def normalize_image_url(*, url: Any) -> str | None:
    """Validate, normalize, and auto-convert image URLs/data-URIs for LLM vision models.

    OpenAI vision endpoints only support: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].
    If an image is in another format (like AVIF, HEIC, TIFF, BMP) or has mismatched MIME headers
    (e.g., AVIF disguised as data:image/jpeg), Pillow is used to safely convert it to JPEG.
    If the image data is completely corrupted or unreadable, returns None.
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

    try:
        header, _, b64_data = trimmed.partition(",")
        if not b64_data:
            return None

        data = base64.b64decode(b64_data)
        if not data:
            return None

        with Image.open(io.BytesIO(data)) as im:
            detected_format = (im.format or "").upper()
            declared_mime = header.split(";")[0].replace("data:", "").strip().lower()

            # Handle jpg -> jpeg alias
            if declared_mime == "image/jpg":
                declared_mime = "image/jpeg"

            expected_mime = f"image/{detected_format.lower()}"
            if expected_mime == "image/jpg":
                expected_mime = "image/jpeg"

            # If format is already supported and matches the header, it's valid as-is
            if (
                detected_format in SUPPORTED_IMAGE_FORMATS
                and declared_mime == expected_mime
            ):
                return trimmed

            # Otherwise (e.g. AVIF, BMP, TIFF, or mismatched header like AVIF declared as JPEG),
            # convert to clean standard JPEG
            logger.info(
                "Auto-converting image to JPEG for LLM compatibility (detected=%s, declared=%s)",
                detected_format,
                declared_mime,
            )
            export_im: Image.Image = im
            if export_im.mode in ("RGBA", "P", "LA"):
                export_im = export_im.convert("RGB")

            out = io.BytesIO()
            export_im.save(out, format="JPEG", quality=85)
            encoded = base64.b64encode(out.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"

    except Exception as exc:
        logger.warning("Failed to parse or convert image data URL: %s", exc)
        return None


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
