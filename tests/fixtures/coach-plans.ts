import type { Plan, NutritionPlan } from "../../src/lib/agent/contracts";
export const trainingFixture:Plan={plan_name:"合成训练计划",goal_type:"maintenance",summary:"每周两天，保留恢复时间。",reasoning_summary:"用于验证，不是个人建议。",warnings:[],weeks:[{week_number:1,focus:"适应",days:[
  {day_number:1,title:"全身 A",notes:"",estimated_duration_minutes:30,exercises:[
    {name:"深蹲",sets:3,rep_range:"8-10",target_rpe:7,rest_seconds:90,notes:"",alternative_exercises:[]},
    {name:"俯卧撑",sets:2,rep_range:"8-12",target_rpe:6,rest_seconds:90,notes:"",alternative_exercises:[]}]},
  {day_number:2,title:"全身 B",notes:"",estimated_duration_minutes:30,exercises:[
    {name:"哑铃划船",sets:2,rep_range:"10-12",target_rpe:6,rest_seconds:90,notes:"",alternative_exercises:[]}]}]}]};
export const nutritionFixture:NutritionPlan={plan_name:"合成饮食计划",goal_type:"maintenance",summary:"一日参考菜单，可轮换食材。",warnings:["营养是估算值。"],daily_targets:{calories:2000,protein_g:120,carbs_g:245,fat_g:60,water_ml:2500},days:[{day_number:1,notes:"按实际饥饿感调整",meals:[
  {meal_type:"breakfast",title:"早餐",foods:[{name:"鸡蛋燕麦",amount:"一份",estimated_calories:500,estimated_protein_g:30,notes:"",alternatives:[]}]},
  {meal_type:"lunch",title:"午餐",foods:[{name:"鸡肉米饭蔬菜",amount:"一份",estimated_calories:800,estimated_protein_g:50,notes:"",alternatives:[]}]},
  {meal_type:"dinner",title:"晚餐",foods:[{name:"鱼肉米饭蔬菜",amount:"一份",estimated_calories:700,estimated_protein_g:40,notes:"",alternatives:[]}]}]}]};
export const planContextFixture={weeklyDays:2,sessionMinutes:45,equipment:["哑铃","自重"],notes:"合成约束"};
