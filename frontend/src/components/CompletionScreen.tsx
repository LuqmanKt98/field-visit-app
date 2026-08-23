export function CompletionScreen() {
    return (
        <div className="completion-screen">
            <div className="completion-icon" aria-hidden="true">
                ✓
            </div>
            {/* Exact wording from the client's brief -- no trailing period. */}
            <h1>The task is complete, you can leave the field</h1>
        </div>
    );
}
