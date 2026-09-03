// Shared header for every dashboard route. The display face (IBM Plex
// Mono) ties each page back to the landing; no tracked-out eyebrow above
// the title — where a page needs to flag a precondition (demo mode, a
// pitch cue) it belongs in the body, not stamped over the heading.
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <h1 className="font-display text-[22px] font-medium tracking-[-0.01em] text-navy">
        {title}
      </h1>
      {children && (
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-muted">{children}</p>
      )}
    </div>
  );
}
