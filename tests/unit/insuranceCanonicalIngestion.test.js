const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Insurance Canonical Ingestion & Mapping Unit Tests', () => {
  function normalizeInsuranceIngestion(rawInsurance, requestedAmount, finances, settings) {
    const raw = rawInsurance || {};
    const amount = Number(requestedAmount || 0);

    const isFuneral = Boolean(
      raw.isFuneralBenefitIncluded ??
      (Number(raw.voluntaryLifePremium || raw.funeralPremium || 0) > 0 ||
       (raw.selectedPlan && raw.selectedPlan !== 'None') ||
       (raw.funeralPlanName && raw.funeralPlanName !== 'None'))
    );
    const funeralCost = Number(raw.funeralPremium ?? raw.voluntaryLifePremium ?? 0);
    const planName = raw.funeralPlanName || raw.selectedPlan || (isFuneral ? 'Standard' : 'None');
    const planId = raw.funeralPlanId || (isFuneral ? planName.toLowerCase() : null);
    const hasLiveQuote = Boolean(raw.quoteId || raw.policyStatus === 'QUOTED' || raw.status === 'QUOTED');

    const configuredPlans = settings?.funeralPlans || [
      { id: 'gold', name: 'Gold', coverMultiplier: 3 },
      { id: 'silver', name: 'Silver', coverMultiplier: 2 },
      { id: 'bronze', name: 'Bronze', coverMultiplier: 1 }
    ];
    const matchedPlan = configuredPlans.find(p => p.id === planId || p.name?.toLowerCase() === planName.toLowerCase());
    const multiplier = matchedPlan?.coverMultiplier ?? 3;
    const funeralCover = isFuneral ? Number(amount * multiplier) : 0;

    return {
      creditLifePremium: Number(raw.creditLifePremium ?? finances?.insuranceAmount ?? 0),
      creditLifeCover: Number(raw.creditLifeCover ?? amount ?? 0),
      isFuneralBenefitIncluded: isFuneral,
      funeralPlanId: planId,
      funeralPlanName: planName,
      funeralPremium: isFuneral ? funeralCost : 0,
      funeralCover: funeralCover,
      policyStatus: hasLiveQuote ? 'QUOTED' : 'UNQUOTED',
      bindingState: 'NOT_ATTEMPTED',
      bindingAttempts: 0
    };
  }

  it('TC-ING-01: Correctly maps legacy frontend submission with voluntaryLifePremium to canonical funeralPremium', () => {
    const legacyPayload = {
      selectedPlan: 'Gold',
      creditLifePremium: 270.00,
      voluntaryLifePremium: 450.00,
      totalInsurancePremium: 720.00,
      quoteId: 'QUO-12345',
      status: 'QUOTED'
    };

    const normalized = normalizeInsuranceIngestion(legacyPayload, 15000, { insuranceAmount: 270.00 });

    assert.strictEqual(normalized.isFuneralBenefitIncluded, true);
    assert.strictEqual(normalized.funeralPlanName, 'Gold');
    assert.strictEqual(normalized.funeralPremium, 450.00);
    assert.strictEqual(normalized.creditLifePremium, 270.00);
    assert.strictEqual(normalized.creditLifeCover, 15000);
    assert.strictEqual(normalized.funeralCover, 45000); // 15000 * 3
    assert.strictEqual(normalized.policyStatus, 'QUOTED');
    assert.strictEqual(normalized.bindingState, 'NOT_ATTEMPTED');
    assert.strictEqual(normalized.bindingAttempts, 0);
  });

  it('TC-ING-02: Correctly maps unselected voluntary funeral benefit', () => {
    const noFuneralPayload = {
      selectedPlan: 'None',
      creditLifePremium: 180.00,
      voluntaryLifePremium: 0,
      totalInsurancePremium: 180.00,
      quoteId: 'QUO-99999',
      status: 'QUOTED'
    };

    const normalized = normalizeInsuranceIngestion(noFuneralPayload, 10000, { insuranceAmount: 180.00 });

    assert.strictEqual(normalized.isFuneralBenefitIncluded, false);
    assert.strictEqual(normalized.funeralPlanName, 'None');
    assert.strictEqual(normalized.funeralPremium, 0);
    assert.strictEqual(normalized.creditLifePremium, 180.00);
    assert.strictEqual(normalized.funeralCover, 0);
    assert.strictEqual(normalized.policyStatus, 'QUOTED');
  });

  it('TC-ING-03: Respects custom multiplier from Admin Settings (e.g. Silver 2x)', () => {
    const silverPayload = {
      funeralPlanName: 'Silver',
      funeralPlanId: 'silver',
      voluntaryLifePremium: 300.00,
      quoteId: 'QUO-SILVER',
      status: 'QUOTED'
    };

    const customSettings = {
      funeralPlans: [
        { id: 'silver', name: 'Silver', coverMultiplier: 2 }
      ]
    };

    const normalized = normalizeInsuranceIngestion(silverPayload, 20000, { insuranceAmount: 360.00 }, customSettings);

    assert.strictEqual(normalized.funeralCover, 40000); // 20000 * 2x
    assert.strictEqual(normalized.funeralPlanName, 'Silver');
    assert.strictEqual(normalized.funeralPremium, 300.00);
  });

  it('TC-ING-04: Defaults to UNQUOTED when no external quote reference is provided', () => {
    const draftPayload = {
      selectedPlan: 'Gold',
      voluntaryLifePremium: 450.00
      // No quoteId or status provided
    };

    const normalized = normalizeInsuranceIngestion(draftPayload, 10000, { insuranceAmount: 180.00 });
    assert.strictEqual(normalized.policyStatus, 'UNQUOTED');
  });
});

