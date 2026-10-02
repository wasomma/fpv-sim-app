/*
 * Minimal GeoTIFF writer for the terrain export: one band, Float32,
 * uncompressed, a single strip, little-endian, georeferenced as a
 * geographic WGS 84 (EPSG:4326) PixelIsArea grid with an explicit
 * vertical CRS, plus the GDAL nodata and metadata tags. Dependency-free
 * on purpose: the raster is 200 x 200 posts, and VBS Geo's DEM import
 * (the consumer this exists for) takes GeoTIFF in EPSG:4326 and nothing
 * else, while TerraTools and Mantle read the same file and honour the
 * vertical tag.
 *
 * Layout: 8-byte header, the IFD, the out-of-line tag values, then the
 * pixel data. Tags are written in ascending order as the TIFF 6.0
 * specification requires; GeoKeys likewise.
 */

export type VerticalDatum = "egm96" | "ellipsoid";

/** EPSG codes carried in the GeoKeys for each vertical datum. */
export const VERTICAL_CRS: Record<VerticalDatum, { epsg: number; label: string }> = {
  egm96: { epsg: 5773, label: "EGM96 height (mean sea level)" },
  ellipsoid: { epsg: 4979, label: "WGS 84 ellipsoidal height" },
};

export interface GeoTiffGeoref {
  /** Longitude of the west edge of the first column, degrees. */
  westDeg: number;
  /** Latitude of the north edge of the first row, degrees. */
  northDeg: number;
  /** Pixel width in degrees of longitude. */
  pixelLonDeg: number;
  /** Pixel height in degrees of latitude. */
  pixelLatDeg: number;
  /** Vertical CRS to declare; "none" for a raster that is not a height. */
  vdatum: VerticalDatum | "none";
  nodata: number;
  /** Free-form items written to the GDAL_METADATA tag. */
  metadata?: Record<string, string>;
}

/* TIFF field types. */
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const DOUBLE = 12;
const TYPE_SIZE: Record<number, number> = { [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [DOUBLE]: 8 };

/* Tag numbers. */
const TAG = {
  ImageWidth: 256,
  ImageLength: 257,
  BitsPerSample: 258,
  Compression: 259,
  Photometric: 262,
  StripOffsets: 273,
  SamplesPerPixel: 277,
  RowsPerStrip: 278,
  StripByteCounts: 279,
  PlanarConfiguration: 284,
  SampleFormat: 339,
  ModelPixelScale: 33550,
  ModelTiepoint: 33922,
  GeoKeyDirectory: 34735,
  GeoAsciiParams: 34737,
  GdalMetadata: 42112,
  GdalNodata: 42113,
} as const;

/* GeoKey ids (OGC GeoTIFF 1.1). */
const KEY = {
  GTModelType: 1024,
  GTRasterType: 1025,
  GTCitation: 1026,
  GeodeticCRS: 2048,
  GeogCitation: 2049,
  GeogAngularUnits: 2054,
  VerticalCRS: 4096,
  VerticalCitation: 4097,
  VerticalUnits: 4099,
} as const;

type Entry = { tag: number; type: number; values: number[] | string };

/**
 * Build the GeoKeyDirectory (SHORTs) and the GeoAsciiParams string.
 * Geographic model, PixelIsArea; WGS 84 2D + EGM96 vertical for egm96,
 * WGS 84 3D (ellipsoidal heights, no vertical key) for ellipsoid, plain
 * WGS 84 2D for a raster that is not a height (the canopy density).
 */
function geoKeys(vdatum: VerticalDatum | "none"): { directory: number[]; ascii: string } {
  let ascii = "";
  const keys: number[][] = [];
  const short = (id: number, value: number) => keys.push([id, 0, 1, value]);
  const text = (id: number, value: string) => {
    const s = value + "|";
    keys.push([id, TAG.GeoAsciiParams, s.length, ascii.length]);
    ascii += s;
  };

  short(KEY.GTModelType, 2); // ModelTypeGeographic
  short(KEY.GTRasterType, 1); // RasterPixelIsArea
  if (vdatum === "egm96") {
    text(KEY.GTCitation, "FPV Sim notional terrain, WGS 84 (EPSG:4326) + EGM96 height (EPSG:5773)");
    short(KEY.GeodeticCRS, 4326);
    text(KEY.GeogCitation, "WGS 84");
    short(KEY.GeogAngularUnits, 9102); // degree
    short(KEY.VerticalCRS, VERTICAL_CRS.egm96.epsg);
    text(KEY.VerticalCitation, "EGM96 height");
    short(KEY.VerticalUnits, 9001); // metre
  } else if (vdatum === "ellipsoid") {
    text(KEY.GTCitation, "FPV Sim notional terrain, WGS 84 3D (EPSG:4979), ellipsoidal heights");
    short(KEY.GeodeticCRS, VERTICAL_CRS.ellipsoid.epsg);
    text(KEY.GeogCitation, "WGS 84");
    short(KEY.GeogAngularUnits, 9102);
  } else {
    text(KEY.GTCitation, "FPV Sim notional terrain, WGS 84 (EPSG:4326)");
    short(KEY.GeodeticCRS, 4326);
    text(KEY.GeogCitation, "WGS 84");
    short(KEY.GeogAngularUnits, 9102);
  }
  // Header: KeyDirectoryVersion, KeyRevision, MinorRevision, NumberOfKeys.
  const directory = [1, 1, 1, keys.length, ...keys.flat()];
  return { directory, ascii };
}

function gdalMetadataXml(items: Record<string, string>): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const lines = Object.entries(items).map(([k, v]) => `  <Item name="${esc(k)}">${esc(v)}</Item>`);
  return `<GDALMetadata>\n${lines.join("\n")}\n</GDALMetadata>\n`;
}

/**
 * Serialise a row-major Float32 raster (row 0 = north) as a GeoTIFF.
 */
export function writeFloat32GeoTiff(width: number, height: number, values: Float32Array, g: GeoTiffGeoref): Uint8Array {
  if (values.length !== width * height) throw new Error(`raster has ${values.length} values, expected ${width * height}`);
  const pixelBytes = width * height * 4;
  const keys = geoKeys(g.vdatum);

  const entries: Entry[] = [
    { tag: TAG.ImageWidth, type: LONG, values: [width] },
    { tag: TAG.ImageLength, type: LONG, values: [height] },
    { tag: TAG.BitsPerSample, type: SHORT, values: [32] },
    { tag: TAG.Compression, type: SHORT, values: [1] },
    { tag: TAG.Photometric, type: SHORT, values: [1] }, // BlackIsZero
    { tag: TAG.StripOffsets, type: LONG, values: [0] }, // patched once the layout is known
    { tag: TAG.SamplesPerPixel, type: SHORT, values: [1] },
    { tag: TAG.RowsPerStrip, type: LONG, values: [height] },
    { tag: TAG.StripByteCounts, type: LONG, values: [pixelBytes] },
    { tag: TAG.PlanarConfiguration, type: SHORT, values: [1] },
    { tag: TAG.SampleFormat, type: SHORT, values: [3] }, // IEEE float
    { tag: TAG.ModelPixelScale, type: DOUBLE, values: [g.pixelLonDeg, g.pixelLatDeg, 0] },
    { tag: TAG.ModelTiepoint, type: DOUBLE, values: [0, 0, 0, g.westDeg, g.northDeg, 0] },
    { tag: TAG.GeoKeyDirectory, type: SHORT, values: keys.directory },
    { tag: TAG.GeoAsciiParams, type: ASCII, values: keys.ascii },
  ];
  if (g.metadata && Object.keys(g.metadata).length > 0) {
    entries.push({ tag: TAG.GdalMetadata, type: ASCII, values: gdalMetadataXml(g.metadata) });
  }
  entries.push({ tag: TAG.GdalNodata, type: ASCII, values: String(g.nodata) });
  entries.sort((a, b) => a.tag - b.tag);

  // Layout: header (8) | IFD | out-of-line values | pixels.
  const byteLength = (e: Entry) =>
    typeof e.values === "string" ? e.values.length + 1 : e.values.length * TYPE_SIZE[e.type]!;
  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  let cursor = ifdOffset + ifdSize;
  const offsets = new Map<Entry, number>();
  for (const e of entries) {
    const n = byteLength(e);
    if (n > 4) {
      if (cursor % 2 === 1) cursor++; // word-align out-of-line values
      offsets.set(e, cursor);
      cursor += n;
    }
  }
  if (cursor % 4 !== 0) cursor += 4 - (cursor % 4);
  const pixelOffset = cursor;
  const total = pixelOffset + pixelBytes;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // Header: little-endian, magic 42, first IFD at 8.
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);

  const writeValues = (e: Entry, at: number) => {
    if (typeof e.values === "string") {
      for (let i = 0; i < e.values.length; i++) bytes[at + i] = e.values.charCodeAt(i) & 0x7f;
      bytes[at + e.values.length] = 0;
      return;
    }
    e.values.forEach((v, i) => {
      if (e.type === SHORT) view.setUint16(at + i * 2, v, true);
      else if (e.type === LONG) view.setUint32(at + i * 4, v, true);
      else view.setFloat64(at + i * 8, v, true);
    });
  };

  view.setUint16(ifdOffset, entries.length, true);
  entries.forEach((e, i) => {
    if (e.tag === TAG.StripOffsets) e.values = [pixelOffset];
    const at = ifdOffset + 2 + i * 12;
    const count = typeof e.values === "string" ? e.values.length + 1 : e.values.length;
    view.setUint16(at, e.tag, true);
    view.setUint16(at + 2, e.type, true);
    view.setUint32(at + 4, count, true);
    const off = offsets.get(e);
    if (off === undefined) writeValues(e, at + 8);
    else {
      view.setUint32(at + 8, off, true);
      writeValues(e, off);
    }
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true); // no next IFD

  for (let i = 0; i < values.length; i++) view.setFloat32(pixelOffset + i * 4, values[i]!, true);
  return bytes;
}

/* ------------------------------ reader ------------------------------ */

export interface GeoTiffReadback {
  width: number;
  height: number;
  /** Row-major Float32 raster, row 0 = north. */
  pixels: Float32Array;
  nodata: number | null;
  westDeg: number;
  northDeg: number;
  pixelLonDeg: number;
  pixelLatDeg: number;
  /** GeoKey 2048 (GeodeticCRSGeoKey), or null when absent. */
  geodeticEpsg: number | null;
  /** GeoKey 4096 (VerticalGeoKey), or null when the raster declares no vertical CRS. */
  verticalEpsg: number | null;
}

/**
 * Read back a GeoTIFF this module wrote (or any single-strip, uncompressed,
 * little-endian, one-band Float32 GeoTIFF). Used by the self-check and by
 * the in-app export to prove a file on disk before reporting success; the
 * tests keep their own independent reader on purpose.
 */
export function readFloat32GeoTiff(bytes: Uint8Array): GeoTiffReadback {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x49 || bytes[1] !== 0x49 || view.getUint16(2, true) !== 42) {
    throw new Error("not a little-endian classic TIFF");
  }
  const ifd = view.getUint32(4, true);
  const n = view.getUint16(ifd, true);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    const tag = view.getUint16(at, true);
    const type = view.getUint16(at + 2, true);
    const count = view.getUint32(at + 4, true);
    const inline = count * (TYPE_SIZE[type] ?? 0) <= 4;
    tags.set(tag, { type, count, at: inline ? at + 8 : view.getUint32(at + 8, true) });
  }
  const num = (tag: number): number | null => {
    const t = tags.get(tag);
    if (t === undefined) return null;
    return t.type === SHORT ? view.getUint16(t.at, true) : t.type === LONG ? view.getUint32(t.at, true) : view.getFloat64(t.at, true);
  };
  const doubles = (tag: number): number[] => {
    const t = tags.get(tag);
    if (t === undefined) return [];
    return Array.from({ length: t.count }, (_, i) => view.getFloat64(t.at + i * 8, true));
  };
  const text = (tag: number): string | null => {
    const t = tags.get(tag);
    if (t === undefined) return null;
    let s = "";
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(bytes[t.at + i]!);
    return s;
  };
  const width = num(TAG.ImageWidth);
  const height = num(TAG.ImageLength);
  if (width === null || height === null) throw new Error("missing image dimensions");
  if (num(TAG.BitsPerSample) !== 32 || num(TAG.SampleFormat) !== 3 || num(TAG.SamplesPerPixel) !== 1) {
    throw new Error("not a one-band Float32 raster");
  }
  if (num(TAG.Compression) !== 1) throw new Error("compressed raster");
  const stripOffset = num(TAG.StripOffsets);
  if (stripOffset === null) throw new Error("missing strip offset");
  const count = width * height;
  if (stripOffset + count * 4 > bytes.byteLength) throw new Error("pixel data truncated");
  const pixels = new Float32Array(count);
  for (let i = 0; i < count; i++) pixels[i] = view.getFloat32(stripOffset + i * 4, true);

  const scale = doubles(TAG.ModelPixelScale);
  const tie = doubles(TAG.ModelTiepoint);
  if (scale.length < 2 || tie.length < 5) throw new Error("missing georeferencing");

  const geo = tags.get(TAG.GeoKeyDirectory);
  let geodeticEpsg: number | null = null;
  let verticalEpsg: number | null = null;
  if (geo !== undefined) {
    const keys = view.getUint16(geo.at + 6, true);
    for (let k = 0; k < keys; k++) {
      const at = geo.at + 8 + k * 8;
      const id = view.getUint16(at, true);
      const location = view.getUint16(at + 2, true);
      const value = view.getUint16(at + 6, true);
      if (location !== 0) continue;
      if (id === KEY.GeodeticCRS) geodeticEpsg = value;
      if (id === KEY.VerticalCRS) verticalEpsg = value;
    }
  }
  const nodataText = text(TAG.GdalNodata);
  return {
    width,
    height,
    pixels,
    nodata: nodataText === null ? null : Number(nodataText),
    westDeg: tie[3]!,
    northDeg: tie[4]!,
    pixelLonDeg: scale[0]!,
    pixelLatDeg: scale[1]!,
    geodeticEpsg,
    verticalEpsg,
  };
}
