const stable = (value) => JSON.stringify(value, Object.keys(value || {}).sort());

export function diffPolicy(oldPolicy, proposedPolicy) {
  const oldParams = oldPolicy?.params || {};
  const newParams = proposedPolicy?.params || {};
  const changedParams = Object.keys({ ...oldParams, ...newParams }).filter((key) => stable(oldParams[key]) !== stable(newParams[key])).map((key) => ({ key, from: oldParams[key], to: newParams[key] }));
  const oldRules = new Map((oldPolicy?.rules || []).map((rule) => [rule.id, rule]));
  const newRules = new Map((proposedPolicy?.rules || []).map((rule) => [rule.id, rule]));
  const addedRules = [...newRules.keys()].filter((id) => !oldRules.has(id)).map((id) => newRules.get(id));
  const removedRules = [...oldRules.keys()].filter((id) => !newRules.has(id)).map((id) => oldRules.get(id));
  const changedRules = [...newRules.keys()].filter((id) => oldRules.has(id) && stable(oldRules.get(id)) !== stable(newRules.get(id))).map((id) => ({ id, from: oldRules.get(id), to: newRules.get(id) }));
  const summary = [];
  for (const change of changedParams) {
    const labels = { clubDays: 'Clubbing window', needByDays: 'Need-by window', prefListDays: 'Preferred-supplier lookback', valuationLookbackDays: 'Valuation lookback', consolidationHours: 'PO consolidation window' };
    if (labels[change.key]) summary.push(`${labels[change.key]} changes from ${change.from} to ${change.to}`);
    else summary.push(`Parameter ${change.key} changes from ${JSON.stringify(change.from)} to ${JSON.stringify(change.to)}`);
  }
  addedRules.forEach((rule) => {
    const plant = rule.when?.find((condition) => condition.field === 'plant');
    summary.push(`New rule ${rule.id}${plant ? ` applies only to plant ${plant.value}` : ''}.`);
  });
  removedRules.forEach((rule) => summary.push(`Rule ${rule.id} is removed.`));
  changedRules.forEach((rule) => summary.push(`Rule ${rule.id} changes.`));
  return { addedParams: changedParams.filter((change) => oldParams[change.key] === undefined), removedParams: changedParams.filter((change) => newParams[change.key] === undefined), changedParams, addedRules, removedRules, changedRules, summary };
}

export function policyFor(policies, asOf) {
  const date = new Date(asOf);
  return [...policies].filter((policy) => policy.status === 'ACTIVE' && new Date(policy.effectiveFrom) <= date).sort((left, right) => new Date(right.effectiveFrom) - new Date(left.effectiveFrom))[0] || null;
}
