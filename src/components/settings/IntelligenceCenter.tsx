import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Brain, Sparkles, History, Lightbulb } from 'lucide-react';
import TrainingList from './TrainingList';
import RuleManager from './RuleManager';
import SmartSuggestions from './SmartSuggestions';

interface IntelligenceCenterProps {
  naturalLanguageRules: string;
  onRulesChange: (rules: string) => void;
  movableKeywords: string[];
  lockedKeywords: string[];
}

const IntelligenceCenter: React.FC<IntelligenceCenterProps> = ({
  naturalLanguageRules,
  onRulesChange,
  movableKeywords,
  lockedKeywords
}) => {
  const [activeTab, setActiveTab] = useState('training');

  return (
    <Card className="border-none shadow-sm rounded-2xl bg-white overflow-hidden">
      <CardHeader className="pb-4 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Brain size={22} />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-gray-900">Intelligence Center</CardTitle>
            <CardDescription className="text-indigo-600 font-medium">Train your AI assistant's decision making</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="px-6 pt-4 border-b border-gray-100">
            <TabsList className="bg-gray-100/50 p-1 rounded-xl mb-4">
              <TabsTrigger value="training" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
                <History size={16} />
                Training Mode
              </TabsTrigger>
              <TabsTrigger value="rules" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
                <Sparkles size={16} />
                Custom Rules
              </TabsTrigger>
              <TabsTrigger value="suggestions" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm gap-2">
                <Lightbulb size={16} />
                Suggestions
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6">
            <TabsContent value="training" className="mt-0">
              <TrainingList 
                naturalLanguageRules={naturalLanguageRules}
                movableKeywords={movableKeywords}
                lockedKeywords={lockedKeywords}
              />
            </TabsContent>
            <TabsContent value="rules" className="mt-0">
              <RuleManager 
                rules={naturalLanguageRules} 
                onChange={onRulesChange} 
              />
            </TabsContent>
            <TabsContent value="suggestions" className="mt-0">
              <SmartSuggestions 
                movableKeywords={movableKeywords}
                lockedKeywords={lockedKeywords}
              />
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default IntelligenceCenter;