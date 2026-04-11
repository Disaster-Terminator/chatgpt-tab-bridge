import test from "node:test";
import assert from "node:assert/strict";

import { importExtensionModule } from "./extension-test-harness.mjs";

function createChromeEnvironment() {
  const sessionStore = {};
  const localStore = {};
  const callLog = [];
  let sendMessageHandler = async () => {
    throw new Error("missing_send_message_handler");
  };

  const noopListener = {
    addListener() {}
  };

  return {
    sessionStore,
    localStore,
    callLog,
    setSendMessageHandler(handler) {
      sendMessageHandler = handler;
    },
    reset() {
      for (const key of Object.keys(sessionStore)) {
        delete sessionStore[key];
      }
      for (const key of Object.keys(localStore)) {
        delete localStore[key];
      }
      callLog.length = 0;
      sendMessageHandler = async () => {
        throw new Error("missing_send_message_handler");
      };
    },
    chrome: {
      runtime: {
        onInstalled: noopListener,
        onStartup: noopListener,
        onConnect: noopListener,
        onMessage: noopListener
      },
      action: {
        openPopup: async () => {}
      },
      tabs: {
        onRemoved: noopListener,
        onUpdated: noopListener,
        query: async () => [],
        get: async (tabId) => ({
          id: tabId,
          url: `https://chatgpt.com/c/tab-${tabId}`,
          title: `Tab ${tabId}`
        }),
        sendMessage: async (tabId, message) => {
          callLog.push({ tabId, type: message.type });
          return sendMessageHandler(tabId, message);
        }
      },
      storage: {
        session: {
          get: async (key) => ({ [key]: sessionStore[key] }),
          set: async (payload) => {
            Object.assign(sessionStore, payload);
          }
        },
        local: {
          get: async (key) => ({ [key]: localStore[key] }),
          set: async (payload) => {
            Object.assign(localStore, payload);
          }
        }
      }
    }
  };
}

const chromeEnvironment = createChromeEnvironment();
globalThis.chrome = chromeEnvironment.chrome;

const {
  formatPendingBoundaryStep,
  classifyTargetObservation,
  getHopExecutionPlan,
  runRelayLoop,
  setActiveLoopTokenForTest,
  shouldExposePendingHopBoundary,
  waitForSettledReply
} = await importExtensionModule("background");
const { createInitialState } = await importExtensionModule("core/state-machine");
const { buildRelayEnvelope, hashText } = await importExtensionModule("core/relay-core");
const { APP_STATE_KEY, PHASES, STOP_REASONS } = await importExtensionModule("core/constants");
const { parseChatGptThreadUrl } = await importExtensionModule("core/chatgpt-url");

function createBinding(role, tabId, threadId) {
  const url = `https://chatgpt.com/c/${threadId}`;
  return {
    role,
    tabId,
    title: `${role}-${threadId}`,
    url,
    urlInfo: parseChatGptThreadUrl(url),
    sessionIdentity: {
      kind: "persistent_url",
      tabId,
      role,
      boundAt: "2026-04-09T00:00:00.000Z",
      url,
      urlInfo: parseChatGptThreadUrl(url),
      currentRound: 0
    },
    boundAt: "2026-04-09T00:00:00.000Z"
  };
}

function createObservationSample({
  url,
  latestUserText = null,
  latestAssistantText = null,
  generating = false
}) {
  return {
    identity: {
      url,
      pathname: new URL(url).pathname,
      title: "ChatGPT"
    },
    latestUser: {
      present: latestUserText !== null,
      text: latestUserText,
      hash: latestUserText ? hashText(latestUserText) : null
    },
    latestAssistant: {
      present: latestAssistantText !== null,
      text: latestAssistantText,
      hash: latestAssistantText ? hashText(latestAssistantText) : null
    },
    generating,
    composer: {
      available: true,
      text: "",
      sendButtonReady: true
    }
  };
}

function createRunningState(activeHop) {
  const state = createInitialState();
  state.phase = PHASES.RUNNING;
  state.sessionId = 1;
  state.pendingFreshSession = false;
  state.round = 0;
  state.settings = {
    ...state.settings,
    maxRounds: 1,
    pollIntervalMs: 0,
    settleSamplesRequired: 1,
    hopTimeoutMs: 50
  };
  state.bindings = {
    A: createBinding("A", 1, "thread-a"),
    B: createBinding("B", 99, "thread-drift")
  };
  state.activeHop = activeHop;
  return state;
}

function createHopProgress({ relayPayloadText, targetThreadId }) {
  return {
    sourceHash: hashText("source reply"),
    relayPayloadText,
    baselineUserHash: hashText("baseline user"),
    baselineGenerating: false,
    baselineLatestUserText: "baseline user",
    baselineAssistantHash: hashText("baseline assistant"),
    verificationBaselineSummary: "baseline-summary",
    dispatchReadbackSummary: "dispatch-summary",
    sendTriggerMode: "button",
    sendTransport: "apply:button",
    lastVerificationPollSample: null,
    targetIdentity: {
      normalizedUrl: `https://chatgpt.com/c/${targetThreadId}`
    }
  };
}

function persistState(state) {
  chromeEnvironment.sessionStore[APP_STATE_KEY] = structuredClone(state);
}

function getPersistedState() {
  return chromeEnvironment.sessionStore[APP_STATE_KEY];
}

test.beforeEach(() => {
  chromeEnvironment.reset();
  setActiveLoopTokenForTest(0);
});

test("getHopExecutionPlan maps pending/verifying/waiting_reply to the Task 6 execution stages", () => {
  assert.deepEqual(getHopExecutionPlan("pending"), {
    shouldSend: true,
    shouldVerify: true,
    shouldWait: true
  });
  assert.deepEqual(getHopExecutionPlan("verifying"), {
    shouldSend: false,
    shouldVerify: true,
    shouldWait: true
  });
  assert.deepEqual(getHopExecutionPlan("waiting_reply"), {
    shouldSend: false,
    shouldVerify: false,
    shouldWait: true
  });
});

test("shouldExposePendingHopBoundary exposes a fresh pending hop exactly once per boundary", () => {
  const state = createRunningState({
    sourceRole: "B",
    targetRole: "A",
    targetTabId: 1,
    round: 2,
    hopId: null,
    stage: "pending"
  });
  state.runtimeActivity = {
    ...state.runtimeActivity,
    step: "hop_completed",
    sourceRole: "A",
    targetRole: "B",
    pendingRound: 1,
    transport: "ok",
    selector: "ok"
  };

  assert.equal(shouldExposePendingHopBoundary(state, state.activeHop), true);

  state.runtimeActivity.step = formatPendingBoundaryStep("B", "A");
  assert.equal(shouldExposePendingHopBoundary(state, state.activeHop), false);

  state.activeHop = {
    ...state.activeHop,
    hopId: "hop-2",
    stage: "verifying"
  };
  assert.equal(shouldExposePendingHopBoundary(state, state.activeHop), false);
});

test("classifyTargetObservation distinguishes correct, wrong, stale, and unreachable targets", () => {
  const correct = classifyTargetObservation({
    requestedTabId: 2,
    canonicalTargetTabId: 2,
    expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
    observation: {
      ok: true,
      result: createObservationSample({
        url: "https://chatgpt.com/c/thread-b"
      })
    }
  });
  assert.equal(correct.classification, "correct_target");

  const wrong = classifyTargetObservation({
    requestedTabId: 99,
    canonicalTargetTabId: 2,
    expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
    observation: {
      ok: true,
      result: createObservationSample({
        url: "https://chatgpt.com/c/thread-b"
      })
    }
  });
  assert.equal(wrong.classification, "wrong_target");

  const stale = classifyTargetObservation({
    requestedTabId: 2,
    canonicalTargetTabId: 2,
    expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
    observation: {
      ok: true,
      result: createObservationSample({
        url: "https://chatgpt.com/c/thread-c"
      })
    }
  });
  assert.equal(stale.classification, "stale_target");

  const unreachable = classifyTargetObservation({
    requestedTabId: 2,
    canonicalTargetTabId: 2,
    expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
    observation: {
      ok: false,
      error: "receiving_end_does_not_exist"
    }
  });
  assert.equal(unreachable.classification, "unreachable_target");
});

test("runRelayLoop resumes a verifying hop on the canonical target without re-sending", async () => {
  const hopId = "hop-verifying";
  const relayPayloadText = buildRelayEnvelope({
    sourceRole: "A",
    round: 1,
    hopId,
    message: "forwarded payload"
  });

  persistState(
    createRunningState({
      sourceRole: "A",
      targetRole: "B",
      targetTabId: 2,
      round: 1,
      hopId,
      stage: "verifying",
      progress: createHopProgress({ relayPayloadText, targetThreadId: "thread-b" })
    })
  );

  let activityCalls = 0;
  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    if (message.type !== "GET_THREAD_ACTIVITY") {
      throw new Error(`unexpected_message:${message.type}`);
    }

    assert.equal(tabId, 2, "verification/wait should stay on activeHop.targetTabId");
    activityCalls += 1;

    if (activityCalls === 1) {
      return {
        ok: true,
        result: {
          sample: createObservationSample({
            url: "https://chatgpt.com/c/thread-b",
            latestUserText: `${relayPayloadText}\n[BRIDGE_INSTRUCTION]`,
            latestAssistantText: "baseline assistant",
            generating: true
          }),
          generating: true,
          latestAssistantHash: hashText("baseline assistant"),
          latestUserHash: hashText(`${relayPayloadText}\n[BRIDGE_INSTRUCTION]`),
          composerText: "",
          sendButtonReady: true,
          composerAvailable: true
        }
      };
    }

    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestUserText: `${relayPayloadText}\n[BRIDGE_INSTRUCTION]`,
          latestAssistantText: "assistant reply after verification",
          generating: false
        }),
        generating: false,
        latestAssistantHash: hashText("assistant reply after verification"),
        latestUserHash: hashText(`${relayPayloadText}\n[BRIDGE_INSTRUCTION]`),
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  setActiveLoopTokenForTest(41);
  await runRelayLoop(41, getPersistedState().settings);

  const sendCalls = chromeEnvironment.callLog.filter((entry) => entry.type === "SEND_RELAY_MESSAGE");
  assert.equal(sendCalls.length, 0, "verifying resume must not dispatch again");

  const finalState = getPersistedState();
  assert.equal(finalState.phase, "stopped");
  assert.equal(finalState.lastStopReason, STOP_REASONS.MAX_ROUNDS);
  assert.equal(finalState.lastCompletedHop?.targetHash, hashText("assistant reply after verification"));
});

test("runRelayLoop resumes a waiting_reply hop on the canonical target without re-sending", async () => {
  const hopId = "hop-waiting";
  const relayPayloadText = buildRelayEnvelope({
    sourceRole: "A",
    round: 1,
    hopId,
    message: "forwarded payload"
  });

  persistState(
    createRunningState({
      sourceRole: "A",
      targetRole: "B",
      targetTabId: 2,
      round: 1,
      hopId,
      stage: "waiting_reply",
      progress: {
        ...createHopProgress({ relayPayloadText, targetThreadId: "thread-b" }),
        lastVerificationPollSample: "verification-pass"
      }
    })
  );

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2, "waiting resume must stay on activeHop.targetTabId");
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestUserText: `${relayPayloadText}\n[BRIDGE_INSTRUCTION]`,
          latestAssistantText: "assistant reply from waiting stage",
          generating: false
        }),
        generating: false,
        latestAssistantHash: hashText("assistant reply from waiting stage"),
        latestUserHash: hashText(`${relayPayloadText}\n[BRIDGE_INSTRUCTION]`),
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  setActiveLoopTokenForTest(42);
  await runRelayLoop(42, getPersistedState().settings);

  const sendCalls = chromeEnvironment.callLog.filter((entry) => entry.type === "SEND_RELAY_MESSAGE");
  assert.equal(sendCalls.length, 0, "waiting_reply resume must not dispatch again");

  const finalState = getPersistedState();
  assert.equal(finalState.phase, "stopped");
  assert.equal(finalState.lastStopReason, STOP_REASONS.MAX_ROUNDS);
  assert.equal(finalState.lastCompletedHop?.targetHash, hashText("assistant reply from waiting stage"));
});

test("waitForSettledReply does not treat a wrong-target observation as settled progress", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 99);
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: "reply on wrong target",
          generating: false
        }),
        generating: false,
        latestAssistantHash: hashText("reply on wrong target"),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(77);
    const settled = await waitForSettledReply({
      tabId: 99,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 1,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 77
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, "wrong_target");
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply requires a stable changed assistant hash with generating false in the same sample", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;
  let polls = 0;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    polls += 1;

    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: "assistant still generating",
          generating: polls < 3
        }),
        generating: polls < 3,
        latestAssistantHash: hashText("assistant still generating"),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(78);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 6,
        pollIntervalMs: 0,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 78
    });

    assert.equal(settled.ok, true);
    assert.equal(settled.result.hash, hashText("assistant still generating"));
    assert.equal(settled.result.sample.generating, false);
    assert.equal(polls, 3, "settle must wait for a non-generating sample even after hash stability");
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply still requires sampled generating false even for a terminal bridge directive", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;
  const terminalReply = "finished reply\n[BRIDGE_STATE] CONTINUE";

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);

    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: terminalReply,
          generating: true
        }),
        generating: true,
        latestAssistantHash: hashText(terminalReply),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(83);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 4,
        pollIntervalMs: 0,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 83
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, STOP_REASONS.HOP_TIMEOUT);
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply settles when terminal bridge evidence arrives with sampled generating false", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;
  let polls = 0;
  const terminalReply = "finished reply\n[BRIDGE_STATE] CONTINUE";

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    polls += 1;

    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: terminalReply,
          generating: false
        }),
        generating: false,
        latestAssistantHash: hashText(terminalReply),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(85);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 4,
        pollIntervalMs: 0,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 85
    });

    assert.equal(settled.ok, true);
    assert.equal(settled.result.hash, hashText(terminalReply));
    assert.equal(settled.result.sample.generating, false);
    assert.equal(polls, 2);
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply does not settle on a stable changed assistant hash without terminal bridge directive when generating stays stale", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: "stable reply without terminal marker",
          generating: true
        }),
        generating: true,
        latestAssistantHash: hashText("stable reply without terminal marker"),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(84);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 84
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, STOP_REASONS.HOP_TIMEOUT);
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply keeps hop_timeout for correct-target observations that never settle", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: "still generating forever",
          generating: true
        }),
        generating: true,
        latestAssistantHash: hashText("still generating forever"),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(79);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 2,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 79
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, STOP_REASONS.HOP_TIMEOUT);
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply classifies missing assistant facts on the correct target distinctly from hop_timeout", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-b",
          latestAssistantText: null,
          generating: false
        }),
        generating: false,
        latestAssistantHash: null,
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(82);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 1,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 82
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, "reply_observation_missing");
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply does not treat stale_target observation as hop_timeout progress", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    return {
      ok: true,
      result: {
        sample: createObservationSample({
          url: "https://chatgpt.com/c/thread-c",  // Different URL - stale target
          latestAssistantText: "reply on stale thread",
          generating: false
        }),
        generating: false,
        latestAssistantHash: hashText("reply on stale thread"),
        latestUserHash: null,
        composerText: "",
        sendButtonReady: true,
        composerAvailable: true
      }
    };
  });

  try {
    setActiveLoopTokenForTest(80);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 1,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 80
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, "stale_target");
  } finally {
    Date.now = originalDateNow;
  }
});

test("waitForSettledReply does not treat unreachable_target observation as hop_timeout progress", async () => {
  const originalDateNow = Date.now;
  let tick = 0;
  Date.now = () => tick++;

  chromeEnvironment.setSendMessageHandler(async (tabId, message) => {
    assert.equal(message.type, "GET_THREAD_ACTIVITY");
    assert.equal(tabId, 2);
    return {
      ok: false,
      error: "receiving_end_does_not_exist"
    };
  });

  try {
    setActiveLoopTokenForTest(81);
    const settled = await waitForSettledReply({
      tabId: 2,
      canonicalTargetTabId: 2,
      baselineHash: hashText("baseline assistant"),
      expectedTargetIdentity: { normalizedUrl: "https://chatgpt.com/c/thread-b" },
      settings: {
        maxRounds: 1,
        hopTimeoutMs: 3,
        pollIntervalMs: 0,
        settleSamplesRequired: 1,
        bridgeStatePrefix: "[BRIDGE_STATE]",
        continueMarker: "[BRIDGE_STATE] CONTINUE",
        stopMarker: "[BRIDGE_STATE] FREEZE"
      },
      token: 81
    });

    assert.equal(settled.ok, false);
    assert.equal(settled.reason, "unreachable_target");
  } finally {
    Date.now = originalDateNow;
  }
});
