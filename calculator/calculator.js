/* ============================================
   Letterhead Newsletter Operations Gap Calculator
   Math Engine + UI Controller
   ============================================ */

(function () {
  'use strict';

  // ── State ──
  const state = {
    icp: null, // 'media' | 'agency' | 'marketer'
    inputs: {},
  };

  // ── Salary assumptions by ICP (fully-loaded annual cost) ──
  const SALARY = {
    media: 75000,
    agency: 65000,
    marketer: 85000,
  };

  // ── Benchmark assumptions (from Letterhead data) ──
  const BENCHMARKS = {
    productionReduction: 0.75,      // 75% less production time
    engagementLift: 0.30,           // 30% improvement in open rates
    cpmImprovement: 0.15,           // 15% CPM uplift from optimization
    fillRateOptimized: 0.85,        // optimized fill rate target
    revenuePerOpenMedia: 0.008,     // ~$8 RPM for media (ad-supported)
    revenuePerOpenMarketer: 0.025,  // ~$25 RPM for marketers (conversion value)
    dataPointsPerSend: 12,          // avg data points captured per send
  };

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Number formatting ──
  function fmtNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10000) return Math.round(n).toLocaleString('en-US');
    if (n >= 1000) return n.toLocaleString('en-US');
    return n.toString();
  }

  function fmtDollars(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return '$' + Math.round(n).toLocaleString('en-US');
    return '$' + Math.round(n);
  }

  function fmtHours(n) {
    if (n >= 1000) return fmtNumber(Math.round(n)) + ' hrs';
    return Math.round(n) + ' hrs';
  }

  // ── Animated counter ──
  function animateValue(el, endVal, formatter, duration = 800) {
    const start = performance.now();
    const startVal = 0;

    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = startVal + (endVal - startVal) * eased;
      el.textContent = formatter(current);
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  // ── Step Navigation ──
  function goToStep(stepNum) {
    $$('.calc-step').forEach((s) => s.classList.remove('active'));
    $(`#step${stepNum}`).classList.add('active');

    // Progress bar
    const pct = stepNum === 1 ? 33 : stepNum === 2 ? 66 : 100;
    $('#progressFill').style.width = pct + '%';

    $$('.progress-steps .step').forEach((s) => {
      const sn = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (sn < stepNum) s.classList.add('done');
      if (sn === stepNum) s.classList.add('active');
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (stepNum === 3) calculateAndRender();
  }

  // ── ICP Selection ──
  $$('.icp-card').forEach((card) => {
    card.addEventListener('click', () => {
      $$('.icp-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.icp = card.dataset.icp;

      // Show/hide ICP-specific inputs
      const clientsGroup = $('#numClientsGroup');
      const revenueInputs = $('#revenueInputs');
      const hint = $('#numNewslettersHint');

      if (state.icp === 'agency') {
        clientsGroup.style.display = 'block';
        revenueInputs.classList.add('hidden');
        hint.textContent = 'across all clients';
      } else if (state.icp === 'media') {
        clientsGroup.style.display = 'none';
        revenueInputs.classList.remove('hidden');
        hint.textContent = 'across all brands';
      } else {
        clientsGroup.style.display = 'none';
        revenueInputs.classList.add('hidden');
        hint.textContent = '';
      }

      // Show base inputs
      $('#baseInputs').classList.remove('hidden');
    });
  });

  // ── Slider value displays ──
  const sliderConfig = {
    numNewsletters: { suffix: '', el: 'numNewslettersVal' },
    numClients: { suffix: '', el: 'numClientsVal' },
    editionsPerWeek: { suffix: '', el: 'editionsPerWeekVal' },
    hoursPerEdition: { suffix: ' hrs', el: 'hoursPerEditionVal' },
    teamSize: { suffix: '', el: 'teamSizeVal' },
    avgListSize: { suffix: '', el: 'avgListSizeVal', format: fmtNumber },
    currentOpenRate: { suffix: '%', el: 'currentOpenRateVal' },
    adSlotsPerEdition: { suffix: '', el: 'adSlotsPerEditionVal' },
    currentCPM: { suffix: '', el: 'currentCPMVal', prefix: '$' },
    fillRate: { suffix: '%', el: 'fillRateVal' },
  };

  Object.keys(sliderConfig).forEach((id) => {
    const slider = $(`#${id}`);
    if (!slider) return;
    const cfg = sliderConfig[id];

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      const display = cfg.format ? cfg.format(val) : val;
      $(`#${cfg.el}`).textContent = (cfg.prefix || '') + display + (cfg.suffix || '');
    });
  });

  // ── Navigation buttons ──
  $('#toStep2').addEventListener('click', () => goToStep(2));
  $('#toStep3').addEventListener('click', () => goToStep(3));
  $('#backToStep1').addEventListener('click', () => goToStep(1));
  $('#backToStep2').addEventListener('click', () => goToStep(2));

  // ── Show revenue inputs on step 2 based on ICP ──
  const origGoToStep = goToStep;

  // ── Step 2 visibility adjustments ──
  function adjustStep2() {
    const revInputs = $('#revenueInputs');
    if (state.icp === 'media') {
      revInputs.classList.remove('hidden');
    } else {
      revInputs.classList.add('hidden');
    }
  }

  // Override toStep2 click
  $('#toStep2').addEventListener('click', adjustStep2);

  // ── Gather inputs ──
  function gatherInputs() {
    state.inputs = {
      numNewsletters: parseInt($('#numNewsletters').value),
      numClients: parseInt($('#numClients').value) || 1,
      editionsPerWeek: parseInt($('#editionsPerWeek').value),
      hoursPerEdition: parseFloat($('#hoursPerEdition').value),
      teamSize: parseInt($('#teamSize').value),
      avgListSize: parseInt($('#avgListSize').value),
      currentOpenRate: parseInt($('#currentOpenRate').value) / 100,
      adSlotsPerEdition: parseInt($('#adSlotsPerEdition').value) || 0,
      currentCPM: parseInt($('#currentCPM').value) || 25,
      fillRate: parseInt($('#fillRate').value) / 100 || 0.6,
    };
  }

  // ── THE MATH ENGINE ──
  function calculate() {
    const i = state.inputs;
    const b = BENCHMARKS;
    const results = {};

    // ── 1. PRODUCTION TIME ──
    const editionsPerYear = i.numNewsletters * i.editionsPerWeek * 52;
    const currentAnnualHours = editionsPerYear * i.hoursPerEdition;
    const hoursSaved = currentAnnualHours * b.productionReduction;
    const letterheadHours = currentAnnualHours - hoursSaved;
    const fteEquivalent = hoursSaved / 2080; // standard work-year hours
    const salarySavings = fteEquivalent * SALARY[state.icp];

    results.production = {
      currentHours: currentAnnualHours,
      letterheadHours,
      hoursSaved,
      fteEquivalent,
      dollarValue: salarySavings,
      editionsPerYear,
    };

    // ── 2. ENGAGEMENT UPLIFT ──
    const currentOpensPerYear = i.avgListSize * editionsPerYear * i.currentOpenRate;
    const improvedOpenRate = Math.min(i.currentOpenRate * (1 + b.engagementLift), 0.65); // cap at 65%
    const newOpensPerYear = i.avgListSize * editionsPerYear * improvedOpenRate;
    const additionalOpens = newOpensPerYear - currentOpensPerYear;

    // Revenue impact of engagement lift
    let engagementRevenue;
    if (state.icp === 'media') {
      engagementRevenue = additionalOpens * b.revenuePerOpenMedia;
    } else {
      engagementRevenue = additionalOpens * b.revenuePerOpenMarketer;
    }

    results.engagement = {
      currentOpenRate: i.currentOpenRate,
      improvedOpenRate,
      currentOpensPerYear,
      newOpensPerYear,
      additionalOpens,
      dollarValue: engagementRevenue,
    };

    // ── 3. SCALING CAPACITY ──
    const hoursPerNewsletterPerYear = i.editionsPerWeek * 52 * i.hoursPerEdition;
    const additionalNewsletters = Math.floor(hoursSaved / hoursPerNewsletterPerYear);

    // Value of additional newsletters (conservative: each new NL worth $X in audience/revenue)
    let valuePerNewsletter;
    if (state.icp === 'media') {
      valuePerNewsletter = i.avgListSize * i.currentOpenRate * b.revenuePerOpenMedia * i.editionsPerWeek * 52;
    } else if (state.icp === 'agency') {
      // Agencies value = billable hours saved per client
      valuePerNewsletter = hoursPerNewsletterPerYear * (SALARY[state.icp] / 2080) * 1.5; // 1.5x markup
    } else {
      valuePerNewsletter = i.avgListSize * i.currentOpenRate * b.revenuePerOpenMarketer * i.editionsPerWeek * 52;
    }

    results.scaling = {
      additionalNewsletters,
      hoursPerNewsletterPerYear,
      potentialValue: additionalNewsletters * valuePerNewsletter,
    };

    // ── 4. AD REVENUE GAP (media only) ──
    if (state.icp === 'media' && i.adSlotsPerEdition > 0) {
      const totalImpressions = i.avgListSize * i.currentOpenRate * editionsPerYear * i.adSlotsPerEdition;
      const currentAdRevenue = totalImpressions * (i.currentCPM / 1000) * i.fillRate;

      const optimizedFillRate = Math.min(i.fillRate + 0.20, b.fillRateOptimized); // +20% fill or cap at 85%
      const optimizedCPM = i.currentCPM * (1 + b.cpmImprovement);
      const optimizedAdRevenue = totalImpressions * (optimizedCPM / 1000) * optimizedFillRate;

      results.adRevenue = {
        currentRevenue: currentAdRevenue,
        optimizedRevenue: optimizedAdRevenue,
        gap: optimizedAdRevenue - currentAdRevenue,
        currentFillRate: i.fillRate,
        optimizedFillRate,
        currentCPM: i.currentCPM,
        optimizedCPM,
      };
    }

    // ── 5. COMPOUNDING INTELLIGENCE ──
    const totalSendsPerYear = editionsPerYear;
    const totalDataPoints = totalSendsPerYear * i.avgListSize * b.dataPointsPerSend;

    results.compound = {
      sendsPerYear: totalSendsPerYear,
      dataPoints: totalDataPoints,
    };

    // ── TOTAL VALUE ──
    let total = results.production.dollarValue + results.engagement.dollarValue;
    if (results.adRevenue) total += results.adRevenue.gap;
    // Don't double-count scaling (it's potential, not realized)
    results.totalValue = total;
    results.totalWithScaling = total + results.scaling.potentialValue;

    return results;
  }

  // ── RENDER RESULTS ──
  function calculateAndRender() {
    gatherInputs();
    const r = calculate();

    // Results subtitle
    const icpLabels = {
      media: 'media company',
      agency: 'agency',
      marketer: 'marketing team',
    };
    $('#resultsSub').textContent = `Based on a ${icpLabels[state.icp]} with ${fmtNumber(state.inputs.numNewsletters)} newsletters sending ${state.inputs.editionsPerWeek}x/week`;

    // Total value
    animateValue($('#totalValue'), r.totalValue, fmtDollars, 1200);
    const parts = [];
    parts.push(fmtDollars(r.production.dollarValue) + ' in production savings');
    parts.push(fmtDollars(r.engagement.dollarValue) + ' in engagement-driven revenue');
    if (r.adRevenue) parts.push(fmtDollars(r.adRevenue.gap) + ' in ad revenue optimization');
    $('#totalBreakdown').textContent = parts.join('  +  ');

    // ── Card 1: Production ──
    animateValue($('#timeSaved'), r.production.hoursSaved, (v) => fmtHours(v) + '/year');
    $('#timeDetail').textContent = `That's ${r.production.fteEquivalent.toFixed(1)} full-time equivalents worth of work — or ${fmtDollars(r.production.dollarValue)}/year in production cost. Your team produces ${fmtNumber(r.production.editionsPerYear)} editions/year. Each one could take ${(state.inputs.hoursPerEdition * 0.25).toFixed(1)} hours instead of ${state.inputs.hoursPerEdition}.`;

    const timeCurrentPct = 75; // current takes 75% of the bar (reversed to show savings)
    const timeSavedPct = 25;
    setTimeout(() => {
      $('#barTimeCurrent').style.width = '25%'; // with Letterhead
      $('#barTimeSaved').style.width = '75%';   // saved
    }, 300);

    // ── Card 2: Engagement ──
    const openRateOld = (r.engagement.currentOpenRate * 100).toFixed(0);
    const openRateNew = (r.engagement.improvedOpenRate * 100).toFixed(0);
    $('#engagementLift').textContent = `${openRateOld}% → ${openRateNew}% open rate`;
    $('#engagementDetail').textContent = `That's ${fmtNumber(Math.round(r.engagement.additionalOpens))} additional opens per year, translating to approximately ${fmtDollars(r.engagement.dollarValue)} in incremental revenue through higher ad impressions and conversions.`;

    const engOldPct = (r.engagement.currentOpenRate / 0.65) * 100;
    const engNewPct = (r.engagement.improvedOpenRate / 0.65) * 100;
    setTimeout(() => {
      $('#barEngCurrent').style.width = engOldPct + '%';
      $('#barEngNew').style.width = (engNewPct - engOldPct) + '%';
    }, 400);
    $('#engBarLabelOld').textContent = openRateOld + '% now';
    $('#engBarLabelNew').textContent = openRateNew + '% with Letterhead';

    // ── Card 3: Scaling ──
    const addNL = r.scaling.additionalNewsletters;
    if (state.icp === 'agency') {
      $('#scalingMetric').textContent = `+${addNL} newsletters (or +${Math.ceil(addNL / (state.inputs.numNewsletters / state.inputs.numClients))} clients)`;
      $('#scalingDetail').textContent = `The time your team saves could be used to launch ${addNL} more newsletters — enough to onboard new clients without adding headcount. That's potential billable value of ${fmtDollars(r.scaling.potentialValue)}/year.`;
    } else {
      $('#scalingMetric').textContent = `+${addNL} newsletters possible`;
      $('#scalingDetail').textContent = `With the hours freed up, your same team of ${state.inputs.teamSize} could produce and manage ${addNL} additional newsletter titles — without hiring anyone. That's ${fmtDollars(r.scaling.potentialValue)}/year in potential portfolio value.`;
    }

    // ── Card 4: Ad Revenue (media only) ──
    if (r.adRevenue) {
      $('#cardRevenue').style.display = 'block';
      animateValue($('#revenueMetric'), r.adRevenue.gap, (v) => '+' + fmtDollars(v) + '/year');
      $('#revenueDetail').textContent = `Your portfolio's ad inventory is currently earning ${fmtDollars(r.adRevenue.currentRevenue)}/year at ${(r.adRevenue.currentFillRate * 100).toFixed(0)}% fill and $${r.adRevenue.currentCPM} CPM. With optimized fill rates (${(r.adRevenue.optimizedFillRate * 100).toFixed(0)}%) and CPMs ($${r.adRevenue.optimizedCPM.toFixed(0)}), that becomes ${fmtDollars(r.adRevenue.optimizedRevenue)}/year.`;

      const revTotal = r.adRevenue.optimizedRevenue;
      const revOldPct = (r.adRevenue.currentRevenue / revTotal) * 100;
      setTimeout(() => {
        $('#barRevCurrent').style.width = revOldPct + '%';
        $('#barRevNew').style.width = (100 - revOldPct) + '%';
      }, 500);
      $('#revBarLabelOld').textContent = fmtDollars(r.adRevenue.currentRevenue);
      $('#revBarLabelNew').textContent = fmtDollars(r.adRevenue.optimizedRevenue);
    } else {
      $('#cardRevenue').style.display = 'none';
    }

    // ── Card 5: Compounding ──
    animateValue($('#compoundSends'), r.compound.sendsPerYear, fmtNumber, 1000);
    animateValue($('#compoundDataPoints'), r.compound.dataPoints, fmtNumber, 1000);
  }

  // ── Email Modal ──
  $('#ctaEmail').addEventListener('click', () => {
    $('#emailModal').classList.remove('hidden');
  });

  $('#modalClose').addEventListener('click', () => {
    $('#emailModal').classList.add('hidden');
  });

  $('#emailModal').addEventListener('click', (e) => {
    if (e.target === $('#emailModal')) {
      $('#emailModal').classList.add('hidden');
    }
  });

  $('#emailForm').addEventListener('submit', (e) => {
    e.preventDefault();
    // In production, this would POST to a backend/CRM
    const name = $('#emailName').value;
    const email = $('#emailAddr').value;
    const company = $('#emailCompany').value;

    console.log('Lead captured:', { name, email, company, icp: state.icp, inputs: state.inputs });

    // Show confirmation
    $('.modal-content').innerHTML = `
      <div style="text-align:center;padding:20px 0;">
        <div style="font-size:2rem;margin-bottom:12px;">&#10003;</div>
        <h3 style="margin-bottom:8px;">Results sent!</h3>
        <p style="color:var(--text-secondary);">Check your inbox at <strong>${email}</strong>. We'll include relevant case studies for your team.</p>
        <button class="btn-primary" style="margin-top:20px;" onclick="document.getElementById('emailModal').classList.add('hidden')">Close</button>
      </div>
    `;
  });
})();
