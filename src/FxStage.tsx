import { AnimatePresence, motion } from "motion/react";
import type { FxExample } from "./motion-grammar";

function Focus({ example }: { example: FxExample }) {
  const target = example.plan.targets[0];
  const [before = "", after = ""] = example.teacherLine.split(target);

  return (
    <div className="caption-line">
      <span>{before}</span>
      <motion.span
        className="focus-word"
        initial={{ scale: 1, filter: "blur(0px)" }}
        animate={{ scale: [1, 1.14, 1.08], filter: ["blur(0px)", "blur(0px)", "blur(0px)"] }}
        transition={{ duration: 1.35, times: [0, 0.45, 1] }}
      >
        {target}
      </motion.span>
      <span>{after}</span>
    </div>
  );
}

function Build({ example }: { example: FxExample }) {
  return (
    <div className="chain">
      {example.plan.targets.map((target, index) => (
        <div className="chain-step" key={target}>
          <motion.div
            className="structure-node"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: index * 0.55, duration: 0.45 }}
          >
            {target}
          </motion.div>
          {index < example.plan.targets.length - 1 ? (
            <motion.div
              className="chain-arrow"
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ delay: index * 0.55 + 0.34, duration: 0.35 }}
            >
              →
            </motion.div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Compare({ example }: { example: FxExample }) {
  const [left, right] = example.plan.targets;
  return (
    <div className="compare-grid">
      {[left, right].map((target, index) => (
        <motion.div
          className="compare-card"
          key={target}
          initial={{ opacity: 0, x: index === 0 ? -18 : 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.18, duration: 0.5 }}
        >
          <span className="compare-kicker">{index === 0 ? "Concept A" : "Concept B"}</span>
          <strong>{target}</strong>
        </motion.div>
      ))}
    </div>
  );
}

function Transform({ example }: { example: FxExample }) {
  const [from, to] = example.plan.targets;
  return (
    <div className="transform-stage">
      <motion.div
        className="formula formula-old"
        initial={{ opacity: 1, y: 0 }}
        animate={{ opacity: [1, 1, 0.24], y: [0, 0, -12], scale: [1, 1, 0.96] }}
        transition={{ duration: 1.8, times: [0, 0.45, 1] }}
      >
        {from}
      </motion.div>
      <motion.div
        className="transform-arrow"
        initial={{ opacity: 0, scaleX: 0 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ delay: 0.8, duration: 0.45 }}
      >
        →
      </motion.div>
      <motion.div
        className="formula formula-new"
        initial={{ opacity: 0, y: 14, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 1.05, duration: 0.6 }}
      >
        {to}
      </motion.div>
    </div>
  );
}

function Trace() {
  return (
    <div className="trace-stage">
      <svg viewBox="0 0 560 220" role="img" aria-label="Energy profile with traced reaction path">
        <line x1="38" y1="180" x2="528" y2="180" className="axis" />
        <line x1="38" y1="180" x2="38" y2="24" className="axis" />
        <path
          d="M 54 156 C 130 150, 150 48, 250 48 C 328 48, 342 142, 420 142 C 458 142, 484 122, 512 118"
          className="trace-path ghost-path"
        />
        <motion.path
          d="M 54 156 C 130 150, 150 48, 250 48 C 328 48, 342 142, 420 142 C 458 142, 484 122, 512 118"
          className="trace-path active-path"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2.4, ease: "easeInOut" }}
        />
        <motion.circle
          cx="250"
          cy="48"
          r="7"
          className="trace-point"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.05, duration: 0.35 }}
        />
        <motion.text
          x="250"
          y="30"
          textAnchor="middle"
          className="trace-label"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.18, duration: 0.35 }}
        >
          transition state
        </motion.text>
      </svg>
    </div>
  );
}

function Hold({ example }: { example: FxExample }) {
  return (
    <div className="hold-stage">
      <motion.div
        className="hold-context"
        initial={{ opacity: 0.78 }}
        animate={{ opacity: 0.22 }}
        transition={{ delay: 0.65, duration: 0.55 }}
      >
        {example.teacherLine}
      </motion.div>
      <motion.div
        className="hold-structure"
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 0.72, duration: 0.5 }}
      >
        {example.plan.targets[0]}
      </motion.div>
    </div>
  );
}

export function FxStage({ example, replayKey }: { example: FxExample; replayKey: number }) {
  return (
    <div className="stage-shell">
      <AnimatePresence mode="wait">
        <motion.div
          key={`${example.id}-${replayKey}`}
          className="stage-content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {example.operation === "FOCUS" ? <Focus example={example} /> : null}
          {example.operation === "BUILD" ? <Build example={example} /> : null}
          {example.operation === "COMPARE" ? <Compare example={example} /> : null}
          {example.operation === "TRANSFORM" ? <Transform example={example} /> : null}
          {example.operation === "TRACE" ? <Trace /> : null}
          {example.operation === "HOLD" ? <Hold example={example} /> : null}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
