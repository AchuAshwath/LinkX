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

  const showInfoToast = React.useCallback(
    (description: string, title = "Drafting...") => {
      toast.info(title, {
        description,
      })
    },
    [],
  )

  return { showSuccessToast, showErrorToast, showInfoToast }
}

export default useCustomToast
