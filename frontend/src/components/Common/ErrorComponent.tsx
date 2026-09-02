import type { ErrorComponentProps } from "@tanstack/react-router"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"

const ErrorComponent = ({
  error,
}: Partial<ErrorComponentProps> & { error?: Error }) => {
  return (
    <div
      className="flex min-h-screen items-center justify-center flex-col p-4"
      data-testid="error-component"
    >
      <div className="flex items-center z-10">
        <div className="flex flex-col ml-4 items-center justify-center p-4">
          <span className="text-6xl md:text-8xl font-bold leading-none mb-4">
            Error
          </span>
          <span className="text-2xl font-bold mb-2">Oops!</span>
        </div>
      </div>

      <p className="text-lg text-muted-foreground mb-4 text-center z-10">
        {error?.message || "Something went wrong. Please try again."}
      </p>
      {error?.stack && (
        <pre className="max-w-2xl text-xs bg-muted/50 p-4 rounded-xl text-left overflow-auto mb-4 border text-destructive">
          {error.stack}
        </pre>
      )}
      <Link to="/home">
        <Button>Go Home</Button>
      </Link>
    </div>
  )
}

export default ErrorComponent
