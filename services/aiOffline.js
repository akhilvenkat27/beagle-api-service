/**
 * Deterministic “offline” AI responses when GROQ_API_KEY is missing or Groq fails.
 * Shapes match aiService consumers / frontend expectations.
 */

function riskFromProjectData(d) {
  const overdue = d.overdueTasks || 0;
  const burn =
    d.totalBudgetHours > 0 ? Math.round((d.totalLoggedHours / d.totalBudgetHours) * 100) : 0;
  let score = 25;
  if (overdue > 8) score += 35;
  else if (overdue > 3) score += 22;
  else if (overdue > 0) score += 12;
  if (burn > 95) score += 18;
  else if (burn > 80) score += 10;
  if ((d.overallProgress || 0) < 35) score += 12;
  score = Math.min(100, Math.max(8, score));
  let riskLevel = 'Low';
  if (score >= 75) riskLevel = 'Critical';
  else if (score >= 55) riskLevel = 'High';
  else if (score >= 38) riskLevel = 'Medium';
  const topRisks = [];
  if (overdue > 0) topRisks.push(`${overdue} overdue task(s) — reprioritize owners and dates.`);
  if (burn > 85) topRisks.push(`Burn is ~${burn}% of module budgets — validate scope vs capacity.`);
  if ((d.overallProgress || 0) < 50 && (d.status === 'Active' || !d.status))
    topRisks.push(`Progress at ${d.overallProgress}% with go-live pressure — tighten weekly milestones.`);
  while (topRisks.length < 3) topRisks.push('Review module dependencies and sign-off readiness.');
  return {
    riskScore: score,
    riskLevel,
    topRisks: topRisks.slice(0, 3),
    recommendation:
      score >= 55
        ? 'Run a delivery risk review this week: freeze scope creep, assign recovery owners on overdue work, and align DH/PM on burn vs margin.'
        : 'Maintain cadence: keep task owners explicit and monitor burn vs budget weekly.',
  };
}

function weeklySummaryFromData(d) {
  const pct = d.overallProgress ?? 0;
  const overdue = d.overdueTasks ?? 0;
  const burn =
    d.totalBudgetHours > 0 ? Math.round((d.totalLoggedHours / d.totalBudgetHours) * 100) : 0;
  return {
    summary: `${d.projectName || 'Project'} is at approximately ${pct}% completion with ${d.completedTasks || 0}/${d.totalTasks || 0} tasks done. ${
      overdue ? `${overdue} tasks are overdue — escalate owners and dates.` : 'No overdue tasks in the snapshot.'
    } Logged hours are about ${burn}% of budgeted module hours; next step is to confirm remaining scope vs timeline and surface blockers in the weekly governance forum.`,
    generatedAt: new Date().toISOString(),
  };
}

function taskFlagsOffline(moduleName, tasks) {
  const flags = [];
  for (const t of tasks) {
    const overdue = t.status !== 'Done' && t.dueDate && new Date(t.dueDate) < new Date();
    const daysUntilDue = t.dueDate
      ? Math.ceil((new Date(t.dueDate) - new Date()) / 86400000)
      : 999;
    if (overdue) {
      flags.push({
        taskId: t._id.toString(),
        title: t.title,
        flag: 'overdue',
        suggestion: 'Set a new committed date or split the work; notify the module lead.',
      });
    } else if (t.status === 'In Progress' && (!t.loggedHours || t.loggedHours === 0)) {
      flags.push({
        taskId: t._id.toString(),
        title: t.title,
        flag: 'stalled',
        suggestion: 'Log progress or move status — “In progress” with zero hours is a delivery risk.',
      });
    } else if (daysUntilDue <= 5 && daysUntilDue >= 0 && t.status !== 'Done') {
      flags.push({
        taskId: t._id.toString(),
        title: t.title,
        flag: 'approaching_deadline',
        suggestion: 'Confirm dependency readiness and daily stand-up until due date.',
      });
    }
  }
  if (!flags.length) {
    flags.push({
      taskId: tasks[0]?._id?.toString() || 'n/a',
      title: (tasks[0] && tasks[0].title) || moduleName || 'Module',
      flag: 'at_risk',
      suggestion: 'No critical flags from rules — continue monitoring burn and dependencies.',
    });
  }
  return { flags };
}

function pmScoreFromMetrics(m) {
  let score = 88;
  score -= Math.min(30, (m.overdueOver7Days || 0) * 4);
  score -= Math.min(15, (m.tasksNoOwner || 0) * 3);
  score -= Math.min(12, (m.modulesWithZeroWorkstreams || 0) * 6);
  score -= Math.min(10, (m.inProgressZeroHours || 0) * 2);
  score -= Math.min(10, (m.staleTasksNotUpdated14d || 0) * 2);
  if ((m.signOffRatePercent || 0) < 40) score -= 12;
  score = Math.max(35, Math.min(98, Math.round(score)));
  let grade = 'A';
  if (score < 45) grade = 'F';
  else if (score < 55) grade = 'D';
  else if (score < 68) grade = 'C';
  else if (score < 80) grade = 'B';
  return {
    disciplineScore: score,
    grade,
    positives: [
      `${m.workstreamsSignedOff || 0}/${m.workstreamsTotal || 0} workstreams signed off (${m.signOffRatePercent || 0}% rate).`,
    ],
    improvements: [],
    summary:
      'Offline assessment from UDIP metrics: discipline reflects overdue depth, owner hygiene, workstream coverage, in-progress logging, and sign-off cadence.',
  };
}

function marginForecastOffline(fin) {
  const cur = Number(fin.marginPercent) || 0;
  const burn = String(fin.burnRate || '').toLowerCase();
  let projected = cur;
  if (burn.includes('high') || burn.includes('over')) projected = Math.max(0, cur - 6);
  else if (burn.includes('medium')) projected = Math.max(0, cur - 3);
  let severity = 'Low';
  if (projected < 10) severity = 'Critical';
  else if (projected < 18) severity = 'High';
  else if (projected < 22) severity = 'Medium';
  return {
    currentMargin: cur,
    projectedMargin: Math.round(projected * 10) / 10,
    weeksUntilThreshold: fin.weeksToThreshold ?? null,
    severity,
    recommendation:
      projected < cur
        ? 'Margin may compress if burn continues — tighten scope, recover overdue tasks, and review cost mix vs baseline.'
        : 'Margin trajectory looks stable in the offline model — keep monitoring EAC vs implementation fee.',
  };
}

function resourceOverloadOffline(overloadedResources) {
  return {
    overloadedResources,
    recommendation:
      overloadedResources.length > 0
        ? 'Several assignees exceed nominal capacity — rebalance tasks and clarify priority lanes with DH/PM.'
        : 'No rule-based overload detected — continue weekly capacity checks against Darwinbox actuals.',
  };
}

function sentimentOffline(emailContent) {
  const t = emailContent.toLowerCase();
  let sentiment = 'Neutral';
  let sentimentScore = 55;
  if (/\b(thanks|great|pleased|excited|appreciate)\b/.test(t)) {
    sentiment = 'Positive';
    sentimentScore = 78;
  }
  if (/\b(concern|disappointed|delay|unacceptable|urgent|escalat)\b/.test(t)) {
    sentiment = 'Negative';
    sentimentScore = 28;
  }
  const keySignals = [];
  if (sentimentScore < 45) keySignals.push('Negative or urgent language');
  if (/\b(scope|change|additional|new requirement)\b/.test(t)) keySignals.push('Possible scope expansion');
  return {
    sentiment,
    sentimentScore,
    keySignals: keySignals.length ? keySignals : ['No strong lexical signals — treat as Neutral.'],
    silenceRisk: emailContent.trim().length < 40,
    recommendation:
      sentimentScore < 45
        ? 'Acknowledge concerns within 24h, propose a recovery call, and log a RAID item if not already tracked.'
        : 'Reply with milestone clarity and owners; keep sponsor visibility in the client portal.',
  };
}

function escalationOffline(ctx) {
  const d = ctx.projectData || {};
  const overdue = d.overdueTasks || 0;
  const prob = Math.min(92, 18 + overdue * 5 + (ctx.taskDelayCompositeScore || 0) * 0.4);
  let riskLevel = 'Low';
  if (prob >= 70) riskLevel = 'Critical';
  else if (prob >= 50) riskLevel = 'High';
  else if (prob >= 32) riskLevel = 'Medium';
  return {
    escalationProbability: Math.round(prob),
    riskLevel,
    triggerSignals: [
      overdue ? `${overdue} overdue tasks` : 'Schedule pressure',
      ctx.daysClientSilence != null ? `${ctx.daysClientSilence}d since last client comment` : 'Limited client thread signal',
    ],
    suggestedActions: [
      'Weekly steering with sponsor',
      'RAID review and date reset on top overdue items',
    ],
    daysUntilEscalation: Math.max(3, Math.min(21, 14 - Math.floor(prob / 12))),
  };
}

function scopeCheckOffline(emailContent, scopeSummary) {
  const t = emailContent.toLowerCase();
  const creepKeywords = /\b(also need|additionally|new module|extra work|phase 2|out of scope|another system)\b/;
  const detected = creepKeywords.test(t);
  return {
    scopeCreepDetected: detected,
    confidence: detected ? 62 : 22,
    creepDescription: detected
      ? 'Email language suggests additional deliverables beyond the named modules/workstreams.'
      : 'No strong offline indicators of scope creep — still review with PM before committing.',
    affectedModules: detected ? (scopeSummary.modules || []).slice(0, 2) : [],
    draftCR: {
      title: detected ? 'Client-requested scope extension' : '',
      description: detected ? 'Align SOW delta with finance before scheduling build.' : '',
      estimatedImpactHours: detected ? 80 : 0,
      estimatedImpactDays: detected ? 10 : 0,
    },
  };
}

function narrativeOffline(projectData, fin, aud) {
  const p = projectData.projectName || 'Project';
  const pct = projectData.overallProgress ?? 0;
  const margin = fin ? `${fin.marginPercent}% margin` : 'financials loading';
  let narrative = '';
  if (aud === 'client') {
    narrative = `${p} is tracking toward key milestones with overall completion near ${pct}%. We remain focused on go-live readiness and transparent weekly updates; ${margin} is monitored internally to protect delivery quality.`;
  } else if (aud === 'exec') {
    narrative = `${p}: delivery health reflects ${pct}% task completion with active governance on burn and margin (${margin}).`;
  } else if (aud === 'dh') {
    narrative = `Portfolio view for ${p}: module burn and overdue workstreams should be reviewed with PM leads; completion is about ${pct}% with financial context (${margin}).`;
  } else {
    narrative = `PM narrative for ${p}: ${pct}% of tasks complete, ${projectData.overdueTasks || 0} overdue. Prioritize owner clarity on late items and align dependencies before the next milestone review.`;
  }
  return {
    audience: aud,
    narrative,
    generatedAt: new Date().toISOString(),
    approvalRequired: aud === 'client',
  };
}

function chatAnswerOffline(projectData, question) {
  const q = (question || '').toLowerCase();
  const d = projectData;
  if (q.includes('risk') || q.includes('block')) {
    return `From current UDIP data, ${d.overdueTasks || 0} tasks are overdue and overall progress is about ${d.overallProgress || 0}%. Focus on the highest-burn modules first.`;
  }
  if (q.includes('progress') || q.includes('status')) {
    return `${d.projectName || 'The project'} shows ~${d.overallProgress || 0}% completion (${d.completedTasks || 0}/${d.totalTasks || 0} tasks done) with ${d.inProgressTasks || 0} in progress.`;
  }
  return `${d.projectName || 'This project'} has ${d.totalTasks || 0} tasks, ${d.overdueTasks || 0} overdue, and logged hours at ${d.totalLoggedHours || 0} against ${d.totalBudgetHours || 0} budgeted module hours. Ask about risks, margin, or a specific module for more detail.`;
}

function crImpactOffline(crPayload) {
  const h = Number(crPayload?.estimatedHours ?? crPayload?.hours ?? 12) || 12;
  return {
    impactDays: Math.max(1, Math.round(h / 6)),
    impactCost: Math.round(h * 4500),
    impactMarginShift: Math.min(-0.5, -Math.round((h / 200) * 10) / 10),
    recommendation:
      'Offline estimate: validate hours with PM/DH and rerun impact after baseline review — use formal CR workflow for sponsor approval.',
  };
}

function raidFromNotesOffline(notes) {
  const lines = notes
    .split(/\n|;|•/)
    .map((s) => s.trim())
    .filter(Boolean);
  const raidItems = [];
  for (const line of lines.slice(0, 8)) {
    if (line.length < 8) continue;
    let type = 'Issue';
    if (/risk|concern/i.test(line)) type = 'Risk';
    if (/depend|waiting on|blocked by/i.test(line)) type = 'Dependency';
    if (/assume|assumption/i.test(line)) type = 'Assumption';
    raidItems.push({
      type,
      description: line.slice(0, 500),
      owner: null,
      suggestedOwner: null,
      priority: line.length > 120 ? 'High' : 'Medium',
    });
  }
  if (!raidItems.length) {
    raidItems.push({
      type: 'Issue',
      description: 'Follow up on meeting notes — no structured bullets detected for RAID extraction.',
      owner: null,
      suggestedOwner: null,
      priority: 'Medium',
    });
  }
  return { raidItems };
}

module.exports = {
  riskFromProjectData,
  weeklySummaryFromData,
  taskFlagsOffline,
  pmScoreFromMetrics,
  marginForecastOffline,
  resourceOverloadOffline,
  sentimentOffline,
  escalationOffline,
  scopeCheckOffline,
  narrativeOffline,
  chatAnswerOffline,
  crImpactOffline,
  raidFromNotesOffline,
};
