// A single reusable "boxed prompt" used anywhere the app needs to group a
// short explanation with the one action it leads to (start preparing,
// connect Telegram, a status update) — instead of each screen inventing
// its own floating button + floating text combo with a different style
// every time. `tone` picks a color family from the existing palette so
// each use still reads as "this app", not a generic gray box.
export default function ActionCard({ icon, title, description, tone = 'mint', children }) {
  return (
    <div className={`action-card tone-${tone}`}>
      {(icon || title) && (
        <div className="action-card-head">
          {icon && <span className="action-card-icon">{icon}</span>}
          {title && <span className="action-card-title">{title}</span>}
        </div>
      )}
      {description && <div className="action-card-desc">{description}</div>}
      {children}
    </div>
  );
}
