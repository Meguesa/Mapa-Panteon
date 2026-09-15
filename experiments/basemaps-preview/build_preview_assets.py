from __future__ import annotations

import io
import math
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

CENTER_LAT = 25.81632700772623
CENTER_LNG = -100.15612317763441
WIDTH_METERS = 516.0
ROTATION_DEG = 5.7
DATA_ASPECT = 11100 / 9250
SATELLITE_ZOOM = 19
TILE_SIZE = 256
MAX_LINES_DIM = 4096
# Mantener ambos rasters con las mismas dimensiones de pixeles. El satelite
# sigue cubriendo un area 2.2x mayor porque Leaflet lo coloca sobre bounds
# expandidos; esta resolucion coincide practicamente con la fuente Esri z19 y
# evita memoria extra innecesaria en movil.
MAX_SATELLITE_DIM = 4096
SATELLITE_EXTENT_FACTOR = 2.20
ESRI_TILE = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/"
    "World_Imagery/MapServer/tile/{z}/{y}/{x}"
)


def rotate_meters(east: float, north: float, angle_deg: float) -> tuple[float, float]:
    angle = math.radians(angle_deg)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    return (
        east * cos_a + north * sin_a,
        -east * sin_a + north * cos_a,
    )


def local_meters_to_lonlat(east: float, north: float) -> tuple[float, float]:
    east, north = rotate_meters(east, north, ROTATION_DEG)
    lng = CENTER_LNG + east / (111320 * math.cos(math.radians(CENTER_LAT)))
    lat = CENTER_LAT + north / 110540
    return lng, lat


def plan_pixel_to_lonlat(x: float, y: float, width: float, height: float) -> tuple[float, float]:
    height_meters = WIDTH_METERS / DATA_ASPECT
    east = ((x / width) - 0.5) * WIDTH_METERS
    north = (0.5 - (y / height)) * height_meters
    return local_meters_to_lonlat(east, north)


def extended_pixel_to_lonlat(x: float, y: float, width: float, height: float) -> tuple[float, float]:
    height_meters = WIDTH_METERS / DATA_ASPECT
    full_width_meters = WIDTH_METERS * SATELLITE_EXTENT_FACTOR
    full_height_meters = height_meters * SATELLITE_EXTENT_FACTOR
    east = ((x / width) - 0.5) * full_width_meters
    north = (0.5 - (y / height)) * full_height_meters
    return local_meters_to_lonlat(east, north)


def lonlat_to_global_pixel(lng: float, lat: float, zoom: int) -> tuple[float, float]:
    lat = max(-85.05112878, min(85.05112878, lat))
    world = TILE_SIZE * (2**zoom)
    x = (lng + 180.0) / 360.0 * world
    sin_lat = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world
    return x, y


def tile_url(z: int, x: int, y: int) -> str:
    return ESRI_TILE.format(z=z, x=x, y=y)


def fetch_tile(z: int, x: int, y: int) -> Image.Image:
    request = urllib.request.Request(
        tile_url(z, x, y),
        headers={"User-Agent": "Jardines-de-Juan-Pablo-MapaPreview/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return Image.open(io.BytesIO(response.read())).convert("RGB")


def scaled_size(width: int, height: int, max_dim: int) -> tuple[int, int]:
    scale = min(1.0, max_dim / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))


def build_lines(plan: Image.Image, target_size: tuple[int, int], output: Path) -> None:
    reduced = plan.convert("RGB").resize(target_size, Image.Resampling.LANCZOS)
    gray = ImageOps.grayscale(reduced)

    # Fondo blanco -> alpha 0. Trazos oscuros -> negro visible.
    lut = []
    for value in range(256):
        if value >= 220:
            alpha = 0
        elif value <= 145:
            alpha = 255
        else:
            alpha = round((220 - value) / 75 * 255)
        lut.append(alpha)

    alpha = gray.point(lut)
    lines = Image.new("RGBA", target_size, (0, 0, 0, 0))
    lines.putalpha(alpha)
    lines.save(output, "WEBP", lossless=True, method=6)


def build_satellite(target_size: tuple[int, int], output: Path) -> None:
    target_width, target_height = target_size

    # El raster satelital cubre 2.2 veces el ancho/alto del plano. La zona
    # central coincide exactamente con el rectangulo del panteon, mientras que
    # alrededor quedan visibles carreteras, campos y contexto exterior.
    samples = []
    for px, py in ((0.0, 0.0), (float(target_width), 0.0), (0.0, float(target_height))):
        lng, lat = extended_pixel_to_lonlat(px, py, target_width, target_height)
        gx, gy = lonlat_to_global_pixel(lng, lat, SATELLITE_ZOOM)
        samples.append((gx, gy))

    p00, p10, p01 = samples
    ax = (p10[0] - p00[0]) / target_width
    bx = (p01[0] - p00[0]) / target_height
    ay = (p10[1] - p00[1]) / target_width
    by = (p01[1] - p00[1]) / target_height

    p11 = (
        p00[0] + ax * target_width + bx * target_height,
        p00[1] + ay * target_width + by * target_height,
    )
    xs = [p00[0], p10[0], p01[0], p11[0]]
    ys = [p00[1], p10[1], p01[1], p11[1]]

    min_tx = math.floor(min(xs) / TILE_SIZE) - 1
    max_tx = math.floor(max(xs) / TILE_SIZE) + 1
    min_ty = math.floor(min(ys) / TILE_SIZE) - 1
    max_ty = math.floor(max(ys) / TILE_SIZE) + 1

    mosaic_width = (max_tx - min_tx + 1) * TILE_SIZE
    mosaic_height = (max_ty - min_ty + 1) * TILE_SIZE
    mosaic = Image.new("RGB", (mosaic_width, mosaic_height))

    total_tiles = (max_tx - min_tx + 1) * (max_ty - min_ty + 1)
    print(f"Descargando {total_tiles} mosaicos Esri z{SATELLITE_ZOOM} para contexto extendido...")
    for ty in range(min_ty, max_ty + 1):
        for tx in range(min_tx, max_tx + 1):
            tile = fetch_tile(SATELLITE_ZOOM, tx, ty)
            mosaic.paste(tile, ((tx - min_tx) * TILE_SIZE, (ty - min_ty) * TILE_SIZE))

    origin_x = min_tx * TILE_SIZE
    origin_y = min_ty * TILE_SIZE
    coeffs = (
        ax,
        bx,
        p00[0] - origin_x,
        ay,
        by,
        p00[1] - origin_y,
    )
    satellite = mosaic.transform(
        target_size,
        Image.Transform.AFFINE,
        coeffs,
        resample=Image.Resampling.BICUBIC,
    )
    satellite.save(output, "WEBP", quality=88, method=6)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Uso: build_preview_assets.py <base-public.webp> <output-dir>")

    plan_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    plan = Image.open(plan_path)
    plan_width, plan_height = plan.size
    lines_size = scaled_size(plan_width, plan_height, MAX_LINES_DIM)

    # Mantener la proporcion del plano pero generar el satelite para bounds
    # 2.2x mayores. La resolucion de pixeles puede ser igual a la del plano:
    # la extension geografica la define Leaflet, no el tamano del archivo.
    raw_sat_width = round(plan_width * SATELLITE_EXTENT_FACTOR)
    raw_sat_height = round(plan_height * SATELLITE_EXTENT_FACTOR)
    satellite_size = scaled_size(raw_sat_width, raw_sat_height, MAX_SATELLITE_DIM)

    print(f"Plano fuente: {plan_width}x{plan_height}")
    print(f"Lineas: {lines_size[0]}x{lines_size[1]}")
    print(f"Satelite extendido: {satellite_size[0]}x{satellite_size[1]} (factor {SATELLITE_EXTENT_FACTOR})")

    build_lines(plan, lines_size, output_dir / "base-lines.webp")
    build_satellite(satellite_size, output_dir / "satellite-base.webp")

    print("Activos geograficos generados:")
    print(output_dir / "base-lines.webp")
    print(output_dir / "satellite-base.webp")


if __name__ == "__main__":
    main()
