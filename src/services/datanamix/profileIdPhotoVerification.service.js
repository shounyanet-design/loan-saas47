const datanamixAxiosClient = require('./datanamixClient');

// ─── Official Datanamix endpoint per sandbox documentation ───────────────────
const ENDPOINT = '/v1/id-verification/ProfilePlusIDVerificationAndPhoto';

/**
 * Converts a Buffer (from multer memory storage) to a plain base64 string
 * with no data-URI prefix — Datanamix expects raw base64 only.
 */
const bufferToBase64 = (buffer) => buffer.toString('base64');

/**
 * Normalizes the real Datanamix ProfilePlusIDVerificationAndPhoto response shape.
 *
 * Official sandbox response structure:
 * {
 *   Success: true,
 *   ResponseCode: 200,
 *   Header: {},
 *   PDFReport: "Base64...",
 *   Result: {
 *     IDVerificationResults: {
 *       ResponseStatusCode: 1,
 *       ResponseMessage: "...",
 *       IDNumberMatchStatus: "Matched",
 *       HanisIDMatch: "Matched",
 *       ReportReference: "DX-0-0",
 *       Names: "Joe",
 *       Surname: "Soap",
 *       Gender: "M",
 *       DateOfBirth: "...",
 *       HanisStatus: "Active"
 *     },
 *     BiometricVerificationResults: {
 *       MatchScore: 0.9,
 *       FaceMatchStatus: "Matched"
 *     }
 *   },
 *   Messages: ["..."]
 * }
 */
const normalizeResponse = (raw) => {
  // ── Primary path: Result.IDVerificationResults ──────────────────────────────
  const idvr = raw?.Result?.IDVerificationResults ?? {};
  const biometric = raw?.Result?.BiometricVerificationResults ?? {};

  // ── Fallback to legacy VerificationResults shape (older endpoints) ──────────
  const vr = Object.keys(idvr).length > 0 ? idvr : (raw?.VerificationResults ?? {});

  // ── Determine success: Success === true, and ResponseCode is either 0 or 200 ──
  const isApiSuccess = raw?.Success === true && (raw?.ResponseCode === 200 || raw?.ResponseCode === 0);

  // ── Status code from ID verification results ─────────────────────────────────
  const statusCode = vr?.ResponseStatusCode ?? (isApiSuccess ? 1 : 0);

  // ── Face match score — BiometricVerificationResults.MatchScore (0-1 → %) ────
  const rawMatchScore = biometric?.MatchScore ?? vr?.MatchScore ?? null;
  const faceMatchScore = rawMatchScore != null ? rawMatchScore * 100 : null;

  // ── Determine verified status ─────────────────────────────────────────────────
  const verificationStatus = (isApiSuccess && statusCode === 1) ? 'Verified' : 'Failed';

  // ── Client Verified Photo (base64 string if returned by HANIS/Biometrics) ──
  const photoBase64 =
    biometric?.ImageBase64 ??
    biometric?.Photo ??
    biometric?.Image ??
    idvr?.ImageBase64 ??
    idvr?.Photo ??
    idvr?.IDPhoto ??
    idvr?.Image ??
    idvr?.VerifiedPhoto ??
    idvr?.BiometricPhoto ??
    vr?.ImageBase64 ??
    vr?.Photo ??
    vr?.IDPhoto ??
    raw?.Photo ??
    raw?.Image ??
    raw?.IDPhoto ??
    null;

  const verificationReference =
    raw?.Header?.ReportReference ??
    vr?.ReportReference ??
    vr?.HanisReference ??
    biometric?.ReportReference ??
    null;

  return {
    // ── Core result ──────────────────────────────────────────────────────────
    responseStatusCode: statusCode,
    responseMessage:
      vr?.ResponseMessage ??
      raw?.Messages?.[0] ??
      (isApiSuccess ? 'Verification Successful' : 'Verification Failed'),
    verificationStatus,

    // ── Biometric score ──────────────────────────────────────────────────────
    faceMatchScore,

    // ── Report reference (e.g. "DX-148-75147940") ────────────────────────────
    verificationReference,

    // ── Verified Client Photo & PDF ──────────────────────────────────────────
    verifiedPhotoBase64: photoBase64,
    verificationPdf: raw?.PDFReport ?? null,

    // ── OCR / ID-extracted identity fields ───────────────────────────────────
    // Maps BOTH new (Names/Surname) and legacy (FirstNames/LastName) field names
    extractedOCRData: {
      FirstNames:          vr?.Names         ?? vr?.FirstNames         ?? null,
      LastName:            vr?.Surname       ?? vr?.LastName            ?? null,
      Gender:              vr?.Gender                                   ?? null,
      DateOfBirth:         vr?.DateOfBirth                              ?? null,
      HanisStatus:         vr?.HanisStatus                              ?? null,
      IDNumberMatchStatus: vr?.IDNumberMatchStatus                      ?? null,
      HanisIDMatch:        biometric?.HanisIDMatch ?? vr?.HanisIDMatch  ?? null,
      FaceMatchStatus:     biometric?.FaceMatchStatus                   ?? null,
      DeceasedStatus:      vr?.DeceasedStatus                           ?? null,
      MarriageStatus:      vr?.MarriageStatus                           ?? null,
      ReportReference:     verificationReference,
    },

    fraudFlags: [],

    // ── Preserved top-level fields ────────────────────────────────────────────
    header:       raw?.Header       ?? {},
    messages:     raw?.Messages     ?? [],
    responseCode: raw?.ResponseCode ?? null,

    // ── Full raw payload for audit storage ────────────────────────────────────
    rawApiResponse: raw,
  };
};

/**
 * Calls the Datanamix "Profile Plus ID Verification And Photo" API.
 *
 * @param {Object} params
 * @param {string}  params.idNumber            - South African ID number (13 digits)
 * @param {Buffer}  params.captureImageBuffer  - Image buffer from multer (ID front / selfie)
 * @param {string}  [params.clientReference]   - Loan/application reference
 * @returns {Promise<Object>} Normalized verification result
 */
const callProfileIdPhotoMatch = async ({
  idNumber,
  captureImageBuffer,
  clientReference,
}) => {
  if (!idNumber) throw new Error('IDNumber is required for KYC verification');
  if (!captureImageBuffer) throw new Error('ID front image is required for KYC verification');

  const captureImage = bufferToBase64(captureImageBuffer);
  const reference = clientReference || `KYC-${Date.now()}`;

  // ── Build payload exactly as per official Datanamix sandbox documentation ───
  const payload = {
    IDNumber: idNumber,
    ClientReference: reference,
    PDFEncryptionPassword: '0123456789',
    EnvironmentType: (process.env.DATANAMIX_ENVIRONMENT === 'PRODUCTION' || process.env.DATANAMIX_ENVIRONMENT === 'LIVE') ? 'LIVE' : 'SANDBOX',
    OutputFormat: 'JSON_AND_PDF',
    CaptureImage: captureImage,
  };

  // ── Debug: log outgoing payload (mask the large base64 image) ──────────────
  console.log('DATANAMIX OUTGOING PAYLOAD', {
    ...payload,
    CaptureImage: `[base64 image — ${captureImage.length} chars]`,
  });

  const response = await datanamixAxiosClient.post(ENDPOINT, payload);

  // ── Debug: log raw Datanamix response ─────────────────────────────────────
  console.log('RAW DATANAMIX RESPONSE', JSON.stringify({
    ...response.data,
    PDFReport: response.data?.PDFReport ? '[PDF base64 omitted]' : null,
  }, null, 2));

  const normalized = normalizeResponse(response.data);

  console.log(
    `[KYC] Result: ${normalized.verificationStatus} | StatusCode: ${normalized.responseStatusCode} | FaceMatch: ${normalized.faceMatchScore}% | Ref: ${normalized.verificationReference}`
  );

  return normalized;
};

module.exports = { callProfileIdPhotoMatch };
