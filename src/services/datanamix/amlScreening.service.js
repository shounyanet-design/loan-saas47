const datanamixAxiosClient = require('./datanamixClient');

const ENDPOINT = '/v1/sanctions-standard/SanctionsIndividual';

const normalizeConfidenceScore = (score) => {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return 0;
  return numericScore <= 1 ? Math.round(numericScore * 100) : numericScore;
};

const clampScore = (score, min, max) => Math.min(max, Math.max(min, score));

/**
 * Normalizes Datanamix AML API response and classifies risk categories
 */
const normalizeResponse = (raw, clientReference) => {
  console.log('[AML-SCREENING RAW RESPONSE]:', raw);

  const header = raw?.Header ?? {};
  const possibleMatches = raw?.PossibleMatches ?? raw?.Result?.PossibleMatches ?? {};
  const results = Array.isArray(possibleMatches?.Results) ? possibleMatches.Results : [];

  const reportReference = raw?.ReportReference ?? header?.ReportReference ?? null;
  const verifiedAt = new Date();

  let pepMatch = false;
  let sanctionsMatch = false;
  let terrorMatch = false;
  let ofacMatch = false;
  let adverseMediaMatch = false;
  let fatfMatch = false;

  let hasFatalMatch = false; // OFAC / Sanctions / Terror (Case 3)
  let hasPartialMatch = false; // PEP / FATF / Adverse Media (Case 2)

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

    // 1. PEP detection
    const isPep = /PEP|Politically Exposed/i.test(sourceText) || /political/i.test(relation);
    if (isPep) {
      pepMatch = true;
      hasPartialMatch = true;
    }

    // 2. OFAC match
    const isOfac = /OFAC/i.test(sourceText);
    if (isOfac) {
      ofacMatch = true;
      hasFatalMatch = true;
    }

    // 3. Terror match
    const isTerror = /SDGT|TERROR|TERRORISM|TERROR FINANCING/i.test(sourceText);
    if (isTerror) {
      terrorMatch = true;
      hasFatalMatch = true;
    }

    // 4. General Sanctions match (OFAC, SDN, or others)
    const isSdn = /SDN/i.test(sourceText);
    const isExplicitBlocked = /BLOCKED|DENIED PERSON|SPECIALLY DESIGNATED|CONSOLIDATED SANCTIONS/i.test(sourceText);
    const isSanctions = isOfac || isSdn || isExplicitBlocked || /SANCTION/i.test(sourceText);
    if (isSanctions) {
      sanctionsMatch = true;
      if (isOfac || isSdn || isExplicitBlocked) {
        hasFatalMatch = true;
      } else {
        hasPartialMatch = true;
      }
    }

    // 5. Adverse Media Match
    const isAdverseMedia = /media|adverse/i.test(sourceText);
    if (isAdverseMedia) {
      adverseMediaMatch = true;
      hasPartialMatch = true;
    }

    // 6. FATF High-Risk Country list
    const isFatf = /FATF|GREY[-\s]?LIST|Financial Action Task Force/i.test(sourceText);
    if (isFatf) {
      fatfMatch = true;
      hasPartialMatch = true;
    }

    // Individual risk assignment
    let matchRiskLevel = 'LOW';
    let confidenceScore = rawConfidenceScore;

    if (isOfac || isSdn || isTerror || isExplicitBlocked) {
      matchRiskLevel = 'CRITICAL';
      confidenceScore = 100;
    } else if (isPep || isFatf) {
      matchRiskLevel = 'MEDIUM';
      confidenceScore = clampScore(rawConfidenceScore || 70, 70, 85);
    } else if (isAdverseMedia) {
      matchRiskLevel = 'MEDIUM';
      confidenceScore = clampScore(rawConfidenceScore || 60, 50, 75);
    } else if (rawConfidenceScore >= 80) {
      matchRiskLevel = 'MEDIUM';
    }

    return {
      matchName,
      source: sourceName || shortName,
      program,
      entityType,
      confidenceScore,
      riskLevel: matchRiskLevel,
      relation,
      dataSource: dataSource.Name || shortName
    };
  });

  // Determine AML Score (100 = Blocked, 70 = Review, 40 = High Risk, 0 = Clean)
  let amlScore = 100; // Default to clean
  let verificationStatus = 'CLEAR';
  let complianceDecision = 'APPROVED';
  let riskLevel = 'LOW';
  let isBlocked = false;
  let riskReason = 'No watchlists or sanctions matches detected.';

  if (hasFatalMatch) {
    // CASE 3: OFAC / SANCTIONS / TERROR MATCH
    verificationStatus = 'AUTO_REJECT';
    complianceDecision = 'AUTO_REJECT';
    riskLevel = 'HIGH';
    isBlocked = true;
    amlScore = 0; // Score 0 for blocked/high risk
    riskReason = 'Borrower matched against critical restricted sanctions or terror watchlist.';
  } else if (hasPartialMatch || results.length > 0) {
    // CASE 2: PARTIAL MATCH / MEDIUM RISK
    verificationStatus = 'REVIEW_REQUIRED';
    complianceDecision = 'REVIEW_REQUIRED';
    riskLevel = 'MEDIUM';
    isBlocked = false;
    amlScore = 70; // Score 70 for review
    riskReason = 'Potential politically exposed person (PEP) or country risk requiring manual review.';
  } else {
    // CASE 1: NO MATCHES (CLEAN)
    verificationStatus = 'CLEAR';
    complianceDecision = 'APPROVED';
    riskLevel = 'LOW';
    isBlocked = false;
    amlScore = 100; // Score 100 for clean
    riskReason = 'No watchlists or sanctions matches detected.';
  }

  const sanctionsStatus = sanctionsMatch ? 'MATCH_FOUND' : 'CLEARED';

  return {
    verificationStatus,
    complianceDecision,
    riskLevel,
    amlScore,
    sanctionsStatus,
    reportReference,
    isBlocked,
    ofacMatch,
    sanctionsMatch,
    terrorMatch,
    pepMatch,
    fatfMatch,
    adverseMediaMatch,
    riskReason,
    matchedEntities,
    rawResponse: raw,
    verifiedAt,
    provider: 'DATANAMIX'
  };
};

/**
 * Invokes the SanctionsIndividual API using Borrower Profile variables
 */
const callAMLScreening = async ({ idNumber, fullName, clientReference, environment }) => {
  if (!idNumber) throw new Error('Identifier (ID Number) is required for AML screening.');
  if (!fullName) throw new Error('Name (Full Name) is required for AML screening.');

  const reference = clientReference || `AML-${Date.now()}`;
  const envType = environment || 'SANDBOX';

  // Build payload exactly as requested
  const payload = {
    EnvironmentType: envType,
    OutputFormat: 'JSON_AND_PDF',
    PDFEncryptionPassword: '0123456789',
    ClientReference: reference,
    Name: fullName.trim(),
    Country: 'ZA',
    MinScore: 90,
    Identifier: idNumber.trim(),
    IdentifierMatchBoostingThreshold: 90,
    DataSource: '',
    Page: 1
  };

  console.log('[AML-SCREENING] Calling Datanamix SanctionsIndividual:', payload);

  try {
    const response = await datanamixAxiosClient.post(ENDPOINT, payload);
    return normalizeResponse(response.data, reference);
  } catch (error) {
    console.error('❌ [AML-SCREENING Service Error]:', error.message);
    const rawError = error.response?.data || { error: error.message };
    
    // Return failed structure
    return {
      verificationStatus: 'FAILED',
      complianceDecision: 'REVIEW_REQUIRED',
      riskLevel: 'HIGH',
      amlScore: 40, // Score 40 for failed check/high risk
      sanctionsStatus: 'UNKNOWN',
      reportReference: null,
      isBlocked: false,
      ofacMatch: false,
      sanctionsMatch: false,
      terrorMatch: false,
      pepMatch: false,
      fatfMatch: false,
      adverseMediaMatch: false,
      riskReason: `API verification failed: ${error.message}`,
      matchedEntities: [],
      rawResponse: rawError,
      verifiedAt: new Date(),
      provider: 'DATANAMIX'
    };
  }
};

module.exports = { callAMLScreening };
