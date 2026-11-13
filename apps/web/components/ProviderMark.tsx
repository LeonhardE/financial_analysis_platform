/** First-party typographic provider badges. No remote assets or third-party artwork. */
export function ProviderMark({ provider }: { provider: string }) {
  const label: Record<string, string> = { muse: "M", chatgpt: "GPT", claude: "C", gemini: "G" };
  return (
    <span
      aria-hidden="true"
      data-provider={provider}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 38,
        height: 38,
        borderRadius: 11,
        fontSize: provider === "chatgpt" ? 10 : 19,
        fontWeight: 650,
        background: "color-mix(in srgb, var(--accent) 10%, var(--panel))",
        color: "var(--accent)",
        flex: "none",
      }}
    >
      {label[provider] ?? "A"}
    </span>
  );
}
