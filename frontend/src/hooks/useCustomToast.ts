import * as React from "react"
import { toast } from "sonner"

const useCustomToast = () => {
  const showSuccessToast = React.useCallback((description: string) => {
    toast.success("Success!", {
      description,
    })
  }, [])

  const showErrorToast = React.useCallback((description: string) => {
    toast.error("Something went wrong!", {
      description,
    })
  }, [])

  return { showSuccessToast, showErrorToast }
}

export default useCustomToast
