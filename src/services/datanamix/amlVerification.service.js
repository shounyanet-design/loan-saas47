const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/sanctions-standard/SanctionsIndividual';

/**
 * Splits a full name safely into firstName, middleName, and lastName.
 */
const splitName = (fullName) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', middleName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], middleName: '', lastName: parts[1] };
  return {
    firstName: parts[0],
    middleName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
};

const normalizeConfidenceScore = (score) => {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return 0;
  return numericScore <= 1 ? Math.round(numericScore * 100) : numericScore;
};

const clampScore = (score, min, max) => Math.min(max, Math.max(min, score));

/**
 * Normalizes Datanamix API response and runs the match detection logic.
 */
const normalizeResponse = (raw, clientReference) => {
  console.log('[AML RAW RESPONSE]:', raw);

  const header = raw?.Header ?? {};
  const possibleMatches = raw?.PossibleMatches ?? raw?.Result?.PossibleMatches ?? {};
  const results = Array.isArray(possibleMatches?.Results) ? possibleMatches.Results : [];

  const reportReference = raw?.ReportReference ?? header?.ReportReference ?? null;
  const screeningDate = header?.SearchDate ? new Date(header.SearchDate) : new Date();

  let pepMatch = false;
  let sanctionsMatch = false;
  let terrorMatch = false;
  let ofacMatch = false;
  let adverseMediaMatch = false;
  let fraudMatch = false;
  let hasFatfRisk = false;
  let autoRejectMatch = false;
  let manualReviewMatch = false;

  const matchedEntities = results.map((match) => {
    const dataSource = match.DataSource ?? {};
    const programArray = Array.isArray(match.Program) ? match.Program : [match.Program].filter(Boolean);
    const program = programArray.join(' ');
    const relation = match.Relation ?? '';
    const shortName = dataSource.ShortName ?? '';
    const sourceName = dataSource.Name ?? '';
    const matchName = match.Name ?? '';
    const entityType = match.EntityType ?? match.Type ?? 'Individual';
    const rawConfidenceScore = normalizeConfidenceScore(
      match.ConfidenceScore ??
      match.confidenceScore ??
      match.MatchConfidence ??
      match.matchConfidence ??
      match.Score ??
      0
    );
    const sourceText = [shortName, sourceName, program, relation].filter(Boolean).join(' ');

    // Match detection rules
    // 1. PEP detection
    const isPep = /PEP/i.test(sourceText) || /political/i.test(relation);
    if (isPep) pepMatch = true;

    // 2. Sanctions detection
    const isOfac = /OFAC/i.test(sourceText);
    const isSdn = /SDN/i.test(sourceText);
    const isTerror = /SDGT|TERROR|TERRORISM|TERROR FINANCING/i.test(sourceText);
    const isExplicitBlocked = /BLOCKED|DENIED PERSON|SPECIALLY DESIGNATED|SPECIAL DESIGNATED|CONSOLIDATED SANCTIONS/i.test(sourceText);
    const isDirectSanction = isOfac || isSdn || isTerror || isExplicitBlocked;
    const isMediumSanction = !isDirectSanction && /SANCTION/i.test(sourceText);
    if (isDirectSanction || isMediumSanction) sanctionsMatch = true;
    if (isDirectSanction) autoRejectMatch = true;

    // 3. Terror detection
    if (isTerror) terrorMatch = true;

    // 4. OFAC Match Specific
    if (isOfac) ofacMatch = true;

    // 5. Adverse Media detection
    const isAdverseMedia = /media|adverse/i.test(sourceText);
    if (isAdverseMedia) adverseMediaMatch = true;

    // 6. Fraud detection
    const isFraud = /FRAUD/i.test(sourceText);
    if (isFraud) fraudMatch = true;

    // 7. FATF / AML Country Risk
    const isFatf = /FATF|GREY[-\s]?LIST|Financial Action Task Force/i.test(sourceText);
    if (isFatf) hasFatfRisk = true;

    // Determine individual match risk level
    let matchRiskLevel = 'LOW';
    let confidenceScore = rawConfidenceScore;
    if (isDirectSanction) {
      matchRiskLevel = 'CRITICAL';
      confidenceScore = 100;
    } else if (isFatf) {
      matchRiskLevel = 'MEDIUM';
      confidenceScore = 75;
      manualReviewMatch = true;
    } else if (isPep) {
      matchRiskLevel = 'MEDIUM';
      confidenceScore = clampScore(rawConfidenceScore || 65, 65, 85);
      manualReviewMatch = true;
    } else if (isMediumSanction || isFraud) {
      matchRiskLevel = 'MEDIUM';
      confidenceScore = clampScore(rawConfidenceScore || 70, 70, 90);
      manualReviewMatch = true;
    } else if (isAdverseMedia) {
      confidenceScore = clampScore(rawConfidenceScore || 50, 50, 70);
      matchRiskLevel = confidenceScore >= 60 ? 'MEDIUM' : 'LOW';
      if (matchRiskLevel === 'MEDIUM') manualReviewMatch = true;
    } else if (rawConfidenceScore >= 85) {
      matchRiskLevel = 'MEDIUM';
      manualReviewMatch = true;
    }

    return {
      matchName,
      source: sourceName || shortName,
      program,
      entityType,
      confidenceScore,
      riskLevel: matchRiskLevel,
      relation
    };
  });

  // NORMALIZATION LOGIC: If PossibleMatches.Results.length > 0 then found = true else false
  const found = results.length > 0;
  const matchCount = results.length;

  // ── AML Score Engine (Fix 2) ────────────────────────────────────────────────
  let amlScore = 0;
  if (autoRejectMatch) {
    amlScore = 100;
  } else if (hasFatfRisk) {
    amlScore = 75;
  } else if (pepMatch) {
    amlScore = 70;
  } else if (matchedEntities.length > 0) {
    amlScore = Math.max(...matchedEntities.map(entity => entity.confidenceScore ?? 0));
  }

  // ── Final Compliance Decision Engine (RISK ENGINE) ─────────────────────────
  let verificationStatus = 'CLEARED';
  let riskLevel = 'LOW';
  let riskReason = 'No watchlists or sanctions matches detected.';

  if (autoRejectMatch) {
    verificationStatus = 'AUTO_REJECT';
    riskLevel = 'HIGH';
    riskReason = 'Borrower matched against restricted sanctions or terror financing databases.';
  } else if (manualReviewMatch || hasFatfRisk || pepMatch || adverseMediaMatch || fraudMatch) {
    verificationStatus = 'MANUAL_REVIEW';
    riskLevel = 'MEDIUM';
    riskReason = hasFatfRisk
      ? 'FATF country monitoring list match requires manual compliance review.'
      : 'Potential politically exposed person or compliance risk detected.';
  }

  // ── Compliance Decision Engine Rules (Fix 7) ───────────────────────────────
  let complianceDecision = 'APPROVED_FOR_REVIEW';
  if (autoRejectMatch) {
    complianceDecision = 'AUTO_REJECT';
  } else if (verificationStatus === 'MANUAL_REVIEW') {
    complianceDecision = 'MANUAL_REVIEW';
  }

  // ── Additional Compliance Properties (Fix 5) ───────────────────────────────
  const sanctionsStatus = sanctionsMatch ? 'MATCH_FOUND' : 'CLEARED';
  const isBlocked = (complianceDecision === 'AUTO_REJECT');
  const screeningTimestamp = screeningDate;
  const fatfMatch = hasFatfRisk;

  const normalizedResult = {
    verificationStatus,
    riskLevel,
    riskReason,
    found,
    pepMatch,
    sanctionsMatch,
    terrorMatch,
    fraudMatch,
    ofacMatch,
    adverseMediaMatch,
    fatfMatch,
    amlScore,
    matchCount,
    matchedEntities,
    reportReference,
    screeningDate,
    rawResponse: raw,
    pdfReport: raw?.PDFReport ?? null,
    clientReference,
    // New compliance engine fields
    sanctionsStatus,
    complianceDecision,
    isBlocked,
    screeningTimestamp
  };

  console.log('[AML NORMALIZED RESULT]:', normalizedResult);

  return normalizedResult;
};

/**
 * Calls the Datanamix Sanctions Screening (Individual Search API).
 */
const callAMLVerification = async ({ idNumber, fullName, clientReference }) => {
  if (!idNumber) throw new Error('Identifier (ID Number) is required for AML screening.');
  if (!fullName) throw new Error('Name (Full Name) is required for AML screening.');

  const reference = clientReference || `AML-${Date.now()}`;

  const payload = {
    EnvironmentType: process.env.DATANAMIX_ENVIRONMENT || 'SANDBOX',
    OutputFormat: 'JSON_AND_PDF',
    PDFEncryptionPassword: idNumber.trim(),
    ClientReference: reference,
    Name: fullName.trim(),
    Country: 'ZA',
    MinScore: 90,
    Identifier: idNumber.trim(),
    IdentifierMatchBoostingThreshold: 90,
    DataSource: '',
    Page: 1
  };

  console.log('[AML FINAL PAYLOAD]:', payload);
  console.log(`[AML-SCREENING] Calling Datanamix SanctionsIndividual — Name: ${fullName} | Ref: ${reference}`);

  try {
    const response = await datanamixAxiosClient.post(ENDPOINT, payload);
    console.log('[AML RAW RESPONSE]:', response.data);
    const normalized = normalizeResponse(response.data, reference);
    return normalized;
  } catch (error) {
    console.error('❌ [AML Service API Error]:', error.message);
    const rawError = error.response?.data || { error: error.message };
    console.log('[AML RAW RESPONSE]:', rawError);
    const failedResult = {
      verificationStatus: 'FAILED',
      riskLevel: 'UNKNOWN',
      riskReason: error.message || 'API request failed.',
      found: false,
      pepMatch: false,
      sanctionsMatch: false,
      terrorMatch: false,
      fraudMatch: false,
      ofacMatch: false,
      adverseMediaMatch: false,
      amlScore: 0,
      matchCount: 0,
      matchedEntities: [],
      reportReference: null,
      screeningDate: new Date(),
      rawResponse: rawError,
      pdfReport: null,
      clientReference: reference
    };
    console.log('[AML NORMALIZED RESULT]:', failedResult);
    return failedResult;
  }
};

module.exports = {
  callAMLVerification,
  splitName
};
