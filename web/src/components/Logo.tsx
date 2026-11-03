export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="logo" style={{ fontSize: size }}>
      On<span className="logo-pill">Duty</span>
    </span>
  );
}
