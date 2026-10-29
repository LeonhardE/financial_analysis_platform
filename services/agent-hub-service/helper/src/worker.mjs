import { ForegroundSession, HelperDenied } from "./session.mjs";
export { ForegroundSession, HelperDenied };

// The trusted owning page transfers two distinct ports exactly once. Giving a
// model the agent port does not give it the enrollment/delivery-pin channel.
let attached = false;
if (typeof self !== "undefined")
  self.onmessage = ({ data }) => {
    if (
      attached ||
      data?.op !== "attach" ||
      !(data.ownerPort instanceof MessagePort) ||
      !(data.agentPort instanceof MessagePort) ||
      data.ownerPort === data.agentPort
    )
      return;
    attached = true;
    const session = new ForegroundSession({
      onInvalidate: (event) => {
        data.ownerPort.postMessage(event);
        data.agentPort.postMessage(event);
      },
    });
    for (const [port, trusted] of [
      [data.ownerPort, true],
      [data.agentPort, false],
    ]) {
      port.onmessage = async ({ data: request }) => {
        const id = typeof request?.id === "string" ? request.id : "invalid";
        try {
          const value = await session.dispatch(request, trusted);
          port.postMessage({ id, ok: true, value });
        } catch (error) {
          port.postMessage({
            id,
            ok: false,
            error: {
              code: error instanceof HelperDenied ? error.code : "crypto_operation_rejected",
            },
          });
        }
      };
      port.start();
    }
  };
