import { trpc } from "@/lib/trpc";
import { useState } from "react";
import LoginScreen from "./LoginScreen";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_PASSWORD: "비밀번호가 올바르지 않습니다.",
  PASSWORD_CHANGE_REQUIRED: "최초 로그인 시 새 비밀번호를 입력해야 합니다.",
  NEW_PASSWORD_TOO_SHORT: "새 비밀번호는 10자 이상이어야 합니다.",
  PASSWORD_NOT_CONFIGURED: "앱 비밀번호가 아직 설정되지 않았습니다.",
};

export default function LoginGate() {
  const [loginError, setLoginError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const passwordStatus = trpc.auth.passwordStatus.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (result) => {
      if (!result.success) {
        setLoginError(LOGIN_ERROR_MESSAGES[result.reason] ?? "로그인에 실패했습니다.");
        return;
      }
      setLoginError(null);
      await utils.auth.me.invalidate();
      await utils.auth.passwordStatus.invalidate();
    },
    onError: (error) => setLoginError(error.message),
  });

  return (
    <LoginScreen
      mustChangePassword={Boolean(passwordStatus.data?.mustChangePassword)}
      loginError={loginError}
      isSubmitting={loginMutation.isPending}
      onSubmit={(input) => loginMutation.mutate(input)}
    />
  );
}
