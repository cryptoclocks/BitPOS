import unittest
from figcraft_layout_ir import compose,bounds,validate_variables,extract
class LayoutIrContract(unittest.TestCase):
 def test_nested_affine_bounds_and_rotation(self):
  self.assertEqual(bounds(compose([1,0,0,1,24,357],[1,0,0,1,14,10]),20,30),[38,367,20,30])
  self.assertEqual(bounds([0,1,-1,0,40,10],20,30),[10,10,30,20])
 def test_alias_cycles_and_missing_targets_fail(self):
  with self.assertRaisesRegex(ValueError,'cycle'):
   validate_variables([{'id':'a','values':{'light':{'type':'alias','value':'b'}}},{'id':'b','values':{'dark':{'type':'alias','value':'a'}}}])
  with self.assertRaisesRegex(ValueError,'Missing'):
   validate_variables([{'id':'a','values':{'light':{'type':'alias','value':'absent'}}}])
 def test_unknown_nodes_are_reported_not_silently_dropped(self):
  doc={'nodes':{'1':{'id':1,'type':'page','children':[2]},'2':{'id':2,'parent':1,'type':'frame','name':'U01-test','width':390,'height':844,'children':[3]},'3':{'id':3,'parent':2,'type':'future-widget','width':10,'height':10}}}
  result=extract(doc,'U01','test-sha',{})
  self.assertEqual(result['reviewRequired'][0]['reason'],'unknown-node-type')
  self.assertEqual(len(result['nodes']),2)
  self.assertFalse(result['automaticWidgetGenerationReady'])
 def test_missing_child_fails_instead_of_emitting_partial_layout(self):
  doc={'nodes':{'1':{'id':1,'type':'page','children':[2]},'2':{'id':2,'parent':1,'type':'frame','name':'U01-test','width':390,'height':844,'children':[3]}}}
  with self.assertRaisesRegex(ValueError,'Missing child'):extract(doc,'U01','test-sha',{})
if __name__=='__main__':unittest.main()
