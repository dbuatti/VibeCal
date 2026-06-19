import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFDFF]">
      <div className="text-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="w-24 h-24 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-lg shadow-indigo-100">
          <Calendar size={48} className="text-indigo-600" />
        </div>
        <div className="space-y-3">
          <h1 className="text-7xl font-black text-gray-900 tracking-tight">404</h1>
          <p className="text-gray-500 font-bold text-sm uppercase tracking-widest">This page doesn't exist</p>
        </div>
        <Link to="/">
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-10 h-14 font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-200">
            Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
