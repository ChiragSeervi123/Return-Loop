"""Checking and saving the optional photo a customer attaches to a return."""
import os
import uuid

from flask import current_app

from config import ALLOWED_PHOTO_EXTENSIONS, MAX_PHOTO_BYTES

# First bytes of each allowed image type, so a renamed .exe is not accepted.
SIGNATURES = {
    "png": [b"\x89PNG\r\n\x1a\n"],
    "jpg": [b"\xff\xd8\xff"],
    "jpeg": [b"\xff\xd8\xff"],
    "webp": [b"RIFF"],
}


class UploadError(Exception):
    pass


def validate_photo(filename, data):
    """Raise UploadError with a friendly message if the photo is not acceptable."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_PHOTO_EXTENSIONS:
        raise UploadError("Photos must be PNG, JPG or WEBP.")
    if len(data) > MAX_PHOTO_BYTES:
        raise UploadError("That photo is over 3 MB. Try a smaller one.")
    if not any(data.startswith(sig) for sig in SIGNATURES[ext]):
        raise UploadError("That file does not look like a real image.")
    if ext == "webp" and data[8:12] != b"WEBP":
        raise UploadError("That file does not look like a real image.")
    return ext


def save_photo(file_storage):
    """Validate and save an uploaded photo. Returns the path relative to /static, or None."""
    if file_storage is None or not file_storage.filename:
        return None
    data = file_storage.read()
    ext = validate_photo(file_storage.filename, data)
    name = f"{uuid.uuid4().hex}.{ext}"
    folder = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as f:
        f.write(data)
    return f"uploads/{name}"
