import base64
import io

from PIL import Image

from app.services.ai_image_utils import normalize_image_url, sanitize_image_urls


def test_normalize_image_url_http_preserved() -> None:
    assert (
        normalize_image_url(url="https://example.com/photo.jpg")
        == "https://example.com/photo.jpg"
    )
    assert (
        normalize_image_url(url="http://example.com/photo.png")
        == "http://example.com/photo.png"
    )


def test_normalize_image_url_rejects_invalid_inputs() -> None:
    assert normalize_image_url(url="") is None
    assert normalize_image_url(url=None) is None
    assert normalize_image_url(url="ftp://example.com/pic.jpg") is None
    assert normalize_image_url(url="data:text/plain;base64,aGVsbG8=") is None
    assert (
        normalize_image_url(url="data:image/jpeg;base64,not-valid-base64-bytes!!")
        is None
    )


def test_normalize_image_url_valid_png_preserved() -> None:
    im = Image.new("RGBA", (10, 10), color="blue")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    url = f"data:image/png;base64,{b64}"

    normalized = normalize_image_url(url=url)
    assert normalized == url


def test_normalize_image_url_valid_jpeg_preserved() -> None:
    im = Image.new("RGB", (10, 10), color="red")
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    url = f"data:image/jpeg;base64,{b64}"

    normalized = normalize_image_url(url=url)
    assert normalized == url


def test_normalize_image_url_converts_bmp_to_jpeg() -> None:
    im = Image.new("RGB", (10, 10), color="green")
    buf = io.BytesIO()
    im.save(buf, format="BMP")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    url = f"data:image/bmp;base64,{b64}"

    normalized = normalize_image_url(url=url)
    assert normalized is not None
    assert normalized.startswith("data:image/jpeg;base64,")

    # Verify result is a readable JPEG
    _, _, res_b64 = normalized.partition(",")
    res_bytes = base64.b64decode(res_b64)
    with Image.open(io.BytesIO(res_bytes)) as res_im:
        assert res_im.format == "JPEG"


def test_sanitize_image_urls_filters_and_converts() -> None:
    im = Image.new("RGB", (5, 5), color="yellow")
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    valid_jpeg = (
        f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"
    )

    input_list = [
        "https://example.com/valid.png",
        "data:image/jpeg;base64,bad-data",
        valid_jpeg,
        "javascript:alert(1)",
    ]
    cleaned = sanitize_image_urls(images=input_list)
    assert len(cleaned) == 2
    assert cleaned[0] == "https://example.com/valid.png"
    assert cleaned[1] == valid_jpeg
