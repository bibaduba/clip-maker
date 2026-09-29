import glob
import json
import os
import sys

import cv2
import numpy as np


def scene_histogram(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    return cv2.normalize(histogram, histogram).flatten()


def face_center(face, image_width):
    x, _y, width, _height = face
    return (float(x) + float(width) / 2.0) / float(image_width)


def mouth_sample(gray, face):
    x, y, width, height = [int(value) for value in face]
    top = y + int(height * 0.55)
    bottom = min(gray.shape[0], y + height)
    left = max(0, x + int(width * 0.12))
    right = min(gray.shape[1], x + int(width * 0.88))
    region = gray[top:bottom, left:right]
    if region.size == 0:
        return None
    return cv2.resize(region, (48, 24), interpolation=cv2.INTER_AREA)


def visual_interest_center(gray):
    """Estimate a safe horizontal focus from text, edges and detailed objects."""
    reduced = cv2.resize(gray, (160, 90), interpolation=cv2.INTER_AREA)
    edges = cv2.Canny(reduced, 70, 150)
    # Horizontal strokes give screen text some extra weight.
    text_like = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((1, 7), np.uint8))
    energy = edges.astype(np.float32) + text_like.astype(np.float32) * 0.55
    columns = energy.sum(axis=0)
    if float(columns.sum()) < 1.0:
        return 0.5, 0.2
    coordinates = np.arange(columns.size, dtype=np.float32)
    center = float((coordinates * columns).sum() / columns.sum()) / float(columns.size - 1)
    concentration = float(columns.max() / max(1.0, columns.mean()))
    confidence = min(0.5, 0.22 + concentration * 0.035)
    return min(0.88, max(0.12, center)), confidence


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: detect-faces.py <frames-directory> <interval>")
    frames_directory = sys.argv[1]
    interval = float(sys.argv[2])
    cascade = cv2.CascadeClassifier(
        os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    )
    points = []
    tracks = {}
    next_track_id = 1
    active_track_id = None
    pending_track_id = None
    pending_count = 0
    missing_frames = 0
    previous_histogram = None
    for index, filename in enumerate(sorted(glob.glob(os.path.join(frames_directory, "frame-*.jpg")))):
        image = cv2.imread(filename)
        if image is None:
            continue
        histogram = scene_histogram(image)
        scene_cut = previous_histogram is not None and cv2.compareHist(previous_histogram, histogram, cv2.HISTCMP_CORREL) < 0.42
        previous_histogram = histogram
        if scene_cut:
            tracks = {}
            active_track_id = None
            pending_track_id = None
            pending_count = 0
            missing_frames = 0
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.12, minNeighbors=5, minSize=(24, 24))
        if len(faces) == 0:
            missing_frames += 1
            held_track = tracks.get(active_track_id)
            if held_track is not None and missing_frames <= 4:
                center, confidence = held_track["center"], 0.55
            else:
                center, confidence = visual_interest_center(gray)
                active_track_id = None
                pending_track_id = None
                pending_count = 0
                tracks = {}
            points.append({
                "time": index * interval,
                "centerX": center,
                "confidence": confidence,
                **({"speakerId": active_track_id} if active_track_id is not None else {}),
                "sceneCut": scene_cut,
            })
            continue

        missing_frames = 0

        detected = []
        available_tracks = set(tracks.keys())
        for face in sorted(faces, key=lambda item: int(item[2]) * int(item[3]), reverse=True):
            center = face_center(face, image.shape[1])
            best_track = None
            best_distance = 1.0
            for track_id in available_tracks:
                distance = abs(center - tracks[track_id]["center"])
                if distance < best_distance and distance < 0.2:
                    best_track = track_id
                    best_distance = distance
            if best_track is None:
                best_track = next_track_id
                next_track_id += 1
            else:
                available_tracks.remove(best_track)

            mouth = mouth_sample(gray, face)
            previous_mouth = tracks.get(best_track, {}).get("mouth")
            mouth_motion = 0.0
            if mouth is not None and previous_mouth is not None:
                mouth_motion = float(np.mean(cv2.absdiff(mouth, previous_mouth))) / 255.0
            x, y, width, height = [int(value) for value in face]
            area = float(width * height) / float(image.shape[0] * image.shape[1])
            center_bias = max(0.0, 1.0 - abs(center - 0.5) * 1.4)
            score = min(1.0, area * 5.0 + mouth_motion * 4.5 + center_bias * 0.06)
            if best_track == active_track_id:
                score += 0.08
            tracks[best_track] = {"center": center, "mouth": mouth, "last": index}
            detected.append((score, best_track, face, center, mouth_motion))

        tracks = {track_id: track for track_id, track in tracks.items() if index - track["last"] <= 3}
        best = max(detected, key=lambda item: item[0])
        current = next((item for item in detected if item[1] == active_track_id), None)
        if active_track_id is None or current is None:
            active_track_id = best[1]
            pending_track_id = None
            pending_count = 0
        elif best[1] == active_track_id:
            pending_track_id = None
            pending_count = 0
        else:
            if pending_track_id == best[1]:
                pending_count += 1
            else:
                pending_track_id = best[1]
                pending_count = 1
            # A very clear mouth-motion win switches immediately; otherwise the
            # challenger must win twice to suppress back-and-forth jitter.
            if best[0] >= current[0] + 0.20 or pending_count >= 2:
                active_track_id = best[1]
                pending_track_id = None
                pending_count = 0
        _score, _track_id, face, center, mouth_motion = next(item for item in detected if item[1] == active_track_id)
        x, _y, width, _height = [int(value) for value in face]
        confidence = min(0.96, 0.68 + min(0.2, mouth_motion * 1.8) + min(0.08, float(width) / float(image.shape[1]) * 0.2))
        points.append({
            "time": index * interval,
            "centerX": center,
            "confidence": confidence,
            "width": float(width) / float(image.shape[1]),
            "speakerId": active_track_id,
            "sceneCut": scene_cut,
        })
    print(json.dumps(points, ensure_ascii=False))


if __name__ == "__main__":
    main()
