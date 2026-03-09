import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="max-w-md w-full border-card-border">
        <CardContent className="pt-6 text-center space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-welcome-title">
            Welcome
          </h1>
          <p className="text-muted-foreground text-sm" data-testid="text-welcome-description">
            Your blank canvas is ready. Start building something great.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
