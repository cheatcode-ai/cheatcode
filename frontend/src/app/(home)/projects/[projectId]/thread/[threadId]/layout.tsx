import type { Metadata, ResolvingMetadata } from 'next'
import { createClerkBackendApi } from '@/lib/api-client'
import { auth } from '@clerk/nextjs/server'
import { ModalProviders } from '@/providers/modal-providers'

type Props = {
  params: Promise<{ projectId: string; threadId: string }>
}

export async function generateMetadata(
  { params }: Props,
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { projectId } = await params
  
  try {
    // Fetch project data for SEO

    // Retrieve the current user's Clerk token (if any) so the backend can authorize the request.
    // If the user is not signed in, getToken() will resolve to null and the backend will only
    // succeed for public projects.
    const { getToken } = await auth()

    const apiClient = createClerkBackendApi(getToken)

    const response = await apiClient.get(`/projects/${projectId}`)
    const project = response.data
    
    const projectName = project?.name || 'Project'
    
    return {
      title: `${projectName} | Cheatcode AI`,
      description: `${projectName} - Interactive agent conversation powered by Cheatcode AI`,
      openGraph: {
        title: `${projectName} | Cheatcode AI`,
        description: `Interactive AI conversation for ${projectName}`,
      },
    }
  } catch (error) {
    // Fallback metadata
    return {
      title: 'Project | Cheatcode AI',
      description: 'Interactive agent conversation powered by Cheatcode AI',
    }
  }
}

export default function ThreadLayout({
  children,
}: {
  children: React.ReactNode
}) {

  return (
    <>
      <ModalProviders />
      {children}
    </>
  )
}
  