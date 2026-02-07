import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SpecialistLogViewer } from '../components/SpecialistLogViewer';

export function SpecialistRunLog() {
  const { project, type, runId } = useParams<{
    project: string;
    type: string;
    runId: string;
  }>();

  if (!project || !type || !runId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-400">Invalid parameters</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <Link
          to={`/specialists/${project}/${type}`}
          className="flex items-center gap-2 text-gray-400 hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to {project}/{type}
        </Link>
      </div>

      <div className="flex-1">
        <SpecialistLogViewer project={project} type={type} runId={runId} />
      </div>
    </div>
  );
}
