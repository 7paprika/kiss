import React, { FormEvent, useState } from "react";

type LoginScreenProps = {
  mustChangePassword: boolean;
  loginError: string | null;
  isSubmitting?: boolean;
  onSubmit: (input: { password: string; newPassword?: string }) => void;
};

export default function LoginScreen({
  mustChangePassword,
  loginError,
  isSubmitting = false,
  onSubmit,
}: LoginScreenProps) {
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      password,
      newPassword: mustChangePassword ? newPassword : undefined,
    });
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card/80 p-8 shadow-2xl backdrop-blur">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Private Trading Console</p>
          <h1 className="text-3xl font-bold tracking-tight">KIS Auto Trader</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            개인 전용 자동매매 대시보드입니다. 앱 전용 비밀번호로 로그인하세요.
          </p>
        </div>

        {mustChangePassword && (
          <div className="mt-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
            최초 로그인입니다. 초기 비밀번호로 인증한 뒤 새 비밀번호로 변경해야 접속할 수 있습니다.
          </div>
        )}

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium">
            앱 비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
              autoComplete="current-password"
              required
            />
          </label>

          {mustChangePassword && (
            <label className="block text-sm font-medium">
              새 비밀번호
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-primary"
                autoComplete="new-password"
                minLength={10}
                required
              />
            </label>
          )}

          {loginError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "처리 중..." : mustChangePassword ? "비밀번호 변경 후 로그인" : "로그인"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Tailscale 내부 개인용 접근을 전제로 한 로컬 앱 비밀번호 인증입니다.
        </p>
      </section>
    </main>
  );
}
