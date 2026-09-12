/** Independent input and expected-result oracle; the simulated interpreter never imports this file. */
export const workload = Array.from({ length: 300 }, (_, i) => {
  const tag = (n: number) => String(n).padStart(3, "0");
  let kind = "FACT",
    subject = i,
    value = 200 + i,
    other: number | null = null,
    text = "";
  if (i % 50 === 25) {
    kind = "CARRY";
    text = `Carry ${tag(i)}: that sample has a name. END.`;
  } else if (i % 50 === 26) {
    kind = "BIND";
    subject = i - 1;
    other = i - 2;
    text = `Bind ${tag(subject)} to ${tag(other)}. END.`;
  } else if (i % 50 === 35) {
    kind = "REVIEW";
    other = i - 1;
    text = `Review ${tag(i)}: that sample follows ${tag(other)}. END.`;
  } else if (i % 50 === 36) {
    kind = "IDENTIFY";
    subject = i - 1;
    other = i - 3;
    text = `Identify ${tag(subject)} as ${tag(other)}. END.`;
  } else if (i % 20 === 10) {
    kind = "CUE";
    subject = i - 1;
    other = i - 2;
    text = `Ask: compare ${tag(subject)} with ${tag(other)} at fixed temperature. END.`;
  } else if (i % 25 === 15) {
    kind = "CORRECT";
    subject = i - 1;
    value = 900 + i;
    text = `Correct ${tag(subject)}: p${tag(subject)}=${value} kPa; keep the condition. END.`;
  } else if (i % 30 === 20) {
    kind = "RELATE";
    subject = i - 1;
    other = i - 2;
    text = `Compare ${tag(subject)} with ${tag(other)}. END.`;
  } else
    text = `Fact ${tag(i)}: p${tag(i)}=${value} kPa at fixed temperature. END.`;
  if (text.length > 80) throw new Error("fixture-record-length");
  return {
    index: i,
    text: text.padEnd(80, " "),
    kind,
    subject,
    value,
    other,
    evidenceReadyAt: i * 2000,
    acceptBy: i * 2000 + 14750 + (kind === "IDENTIFY" ? 12000 : 0),
    requiredLiveRounds: 2,
    requiredStageRounds: kind === "IDENTIFY" ? 2 : 0,
    mustDisplay: kind === "CUE" || i === 0,
  };
});
export const workloadProfile = {
  duration: 600000,
  fragmentInterval: 2000,
  charsPerFragment: 80,
  liveDelays: [500, 2000, 6000],
  stageDelay: 6000,
  displayBudget: 1000,
  maxSourceAge: 14750,
};
