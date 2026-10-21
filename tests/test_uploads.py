import pytest

from services.uploads import UploadError, validate_photo

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 100


def test_png_ok():
    assert validate_photo("crack.png", PNG) == "png"


def test_wrong_extension():
    with pytest.raises(UploadError):
        validate_photo("notes.pdf", b"%PDF-1.4")


def test_renamed_file_rejected():
    with pytest.raises(UploadError):
        validate_photo("photo.jpg", b"MZ not an image")


def test_too_large():
    with pytest.raises(UploadError):
        validate_photo("big.png", PNG + b"0" * (3 * 1024 * 1024))
