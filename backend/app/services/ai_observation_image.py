"""JPEG data URL decoding and dimension checks for transient observations."""

import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError

MAX_OBSERVATION_IMAGE_URL_LENGTH = 2_000_000
MAX_OBSERVATION_IMAGE_PIXELS = 4_194_304
JPEG_DATA_URL_PREFIX = "data:image/jpeg;base64,"


def decode_jpeg_data_url(*, data_url: str) -> bytes:
    """Decode a bounded JPEG data URL, preserving safe validation messages."""
    if len(data_url) > MAX_OBSERVATION_IMAGE_URL_LENGTH:
        raise ValueError("image data URL exceeds size limit")
    if not data_url.startswith(JPEG_DATA_URL_PREFIX):
        raise ValueError("observation image must be a JPEG data URL")
    try:
        return base64.b64decode(data_url[len(JPEG_DATA_URL_PREFIX) :], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64 image data") from exc


def jpeg_dimensions(*, data: bytes) -> tuple[int, int]:
    """Read and fully decode a bounded JPEG, returning its declared dimensions."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG":
                raise ValueError("observation image is not a JPEG")
            width, height = image.size
            if width * height > MAX_OBSERVATION_IMAGE_PIXELS:
                raise ValueError("image pixel count exceeds limit")
            image.load()
            return width, height
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise ValueError("invalid JPEG image") from exc


def validate_jpeg_data_url(*, data_url: str) -> None:
    """Validate JPEG bytes and decoding limits for an observation packet."""
    jpeg_dimensions(data=decode_jpeg_data_url(data_url=data_url))
