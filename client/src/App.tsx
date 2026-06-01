import LoginGate from "@/components/LoginGate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Dashboard from "./pages/Dashboard";

function Router() {
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (meQuery.isLoading) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <p className="text-sm text-muted-foreground">세션 확인 중...</p>
      </main>
    );
  }

  if (!meQuery.data) {
    return <LoginGate />;
  }

  return (
    <Switch>
      <Route path={"/"} component={Dashboard} />
      <Route component={Dashboard} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider delayDuration={300}>
          <Toaster
            theme="dark"
            position="bottom-right"
            toastOptions={{
              style: {
                background: "#18191d",
                border: "1px solid #313238",
                color: "#e6e7eb",
              },
            }}
          />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
