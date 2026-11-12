/* Runs the actual two shipped compute shaders, offscreen, on host Vulkan.
 * Host numerical/ABI evidence only; no Switch VI/presentation qualification. */
#include <vulkan/vulkan.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <stddef.h>
#define CHECK(x) do {VkResult rc=(x);if(rc!=VK_SUCCESS){fprintf(stderr,"%s -> %d\n",#x,rc);exit(1);}}while(0)
#define FIELD(t,f,n) _Static_assert(offsetof(t,f)==n,#t "." #f)
/* LP64 offsets used by civapps-native-ui src/vulkan.js, checked against Khronos headers. */
FIELD(VkImageViewCreateInfo,image,24);FIELD(VkImageViewCreateInfo,viewType,32);FIELD(VkImageViewCreateInfo,format,36);FIELD(VkImageViewCreateInfo,subresourceRange,56);
FIELD(VkBufferCreateInfo,size,24);FIELD(VkBufferCreateInfo,usage,32);
FIELD(VkMemoryAllocateInfo,allocationSize,16);FIELD(VkMemoryAllocateInfo,memoryTypeIndex,24);
FIELD(VkMemoryMapInfoKHR,memory,24);FIELD(VkMemoryMapInfoKHR,size,40);
FIELD(VkDescriptorSetLayoutCreateInfo,bindingCount,20);FIELD(VkDescriptorSetLayoutCreateInfo,pBindings,24);
FIELD(VkDescriptorSetLayoutBinding,stageFlags,12);FIELD(VkWriteDescriptorSet,pBufferInfo,48);
FIELD(VkPipelineLayoutCreateInfo,setLayoutCount,20);FIELD(VkPipelineLayoutCreateInfo,pSetLayouts,24);
FIELD(VkDescriptorPoolCreateInfo,maxSets,20);FIELD(VkDescriptorPoolCreateInfo,poolSizeCount,24);FIELD(VkDescriptorPoolCreateInfo,pPoolSizes,32);
FIELD(VkDescriptorSetAllocateInfo,descriptorSetCount,24);FIELD(VkDescriptorSetAllocateInfo,pSetLayouts,32);
FIELD(VkShaderModuleCreateInfo,codeSize,24);FIELD(VkShaderModuleCreateInfo,pCode,32);
FIELD(VkComputePipelineCreateInfo,stage,24);FIELD(VkComputePipelineCreateInfo,layout,72);
FIELD(VkGraphicsPipelineCreateInfo,pStages,24);FIELD(VkGraphicsPipelineCreateInfo,pViewportState,56);FIELD(VkGraphicsPipelineCreateInfo,pColorBlendState,88);FIELD(VkGraphicsPipelineCreateInfo,layout,104);FIELD(VkGraphicsPipelineCreateInfo,basePipelineIndex,136);
FIELD(VkPipelineViewportStateCreateInfo,pViewports,24);FIELD(VkPipelineViewportStateCreateInfo,pScissors,40);
FIELD(VkPipelineRenderingCreateInfo,pColorAttachmentFormats,24);
FIELD(VkPipelineRasterizationStateCreateInfo,lineWidth,56);
FIELD(VkCommandPoolCreateInfo,queueFamilyIndex,20);FIELD(VkCommandBufferAllocateInfo,commandPool,16);FIELD(VkCommandBufferAllocateInfo,commandBufferCount,28);
FIELD(VkBindDescriptorSetsInfoKHR,stageFlags,16);FIELD(VkBindDescriptorSetsInfoKHR,layout,24);FIELD(VkBindDescriptorSetsInfoKHR,descriptorSetCount,36);FIELD(VkBindDescriptorSetsInfoKHR,pDescriptorSets,40);
FIELD(VkMemoryBarrier2,srcStageMask,16);FIELD(VkMemoryBarrier2,dstAccessMask,40);
FIELD(VkDependencyInfo,pMemoryBarriers,24);FIELD(VkDependencyInfo,pImageMemoryBarriers,56);
FIELD(VkImageMemoryBarrier2,image,64);FIELD(VkImageMemoryBarrier2,subresourceRange,72);
FIELD(VkRenderingAttachmentInfo,imageView,16);FIELD(VkRenderingAttachmentInfo,loadOp,44);
FIELD(VkRenderingInfo,renderArea,20);FIELD(VkRenderingInfo,pColorAttachments,48);
FIELD(VkSubmitInfo,commandBufferCount,40);FIELD(VkSubmitInfo,pCommandBuffers,48);FIELD(VkSubmitInfo,pSignalSemaphores,64);
FIELD(VkPresentInfoKHR,waitSemaphoreCount,16);FIELD(VkPresentInfoKHR,pSwapchains,40);FIELD(VkPresentInfoKHR,pImageIndices,48);
FIELD(VkAcquireNextImageInfoKHR,swapchain,16);FIELD(VkAcquireNextImageInfoKHR,semaphore,32);FIELD(VkAcquireNextImageInfoKHR,deviceMask,48);
static void *readFile(const char *name,size_t *size){FILE *f=fopen(name,"rb");if(!f){perror(name);exit(2);}fseek(f,0,SEEK_END);*size=(size_t)ftell(f);rewind(f);void *p=malloc(*size);if(!p||fread(p,1,*size,f)!=*size)exit(2);fclose(f);return p;}
int main(int argc,char **argv){
 if(argc!=6){fprintf(stderr,"usage: host bin.spv raster.spv packet.bin output.rgba bins.bin\n");return 2;}
 size_t inputSize;uint32_t *input=readFile(argv[3],&inputSize);if(inputSize<64||inputSize>32*1024*1024)return 2;
 uint32_t width=input[0],height=input[1],cols=input[10],rows=input[11];if(!width||!height||width>1920||height>1080||cols!=(width+31)/32||rows!=(height+31)/32)return 2;
 uint32_t binWords=cols*rows*897;if((input[12]!=binWords&&input[12]!=binWords*8)||input[9]>input[12]-binWords)return 2;
 size_t sizes[3]={inputSize,(size_t)width*height*4,((size_t)input[12]+1)*4};
 VkApplicationInfo app={.sType=VK_STRUCTURE_TYPE_APPLICATION_INFO,.apiVersion=VK_API_VERSION_1_1};
 const char *portability="VK_KHR_portability_enumeration";
 VkInstanceCreateInfo instanceInfo={.sType=VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,.pApplicationInfo=&app};
#ifdef __APPLE__
 uint32_t ec=0;CHECK(vkEnumerateInstanceExtensionProperties(NULL,&ec,NULL));VkExtensionProperties *extensions=calloc(ec,sizeof(*extensions));CHECK(vkEnumerateInstanceExtensionProperties(NULL,&ec,extensions));for(uint32_t i=0;i<ec;i++)if(!strcmp(extensions[i].extensionName,portability)){instanceInfo.flags=VK_INSTANCE_CREATE_ENUMERATE_PORTABILITY_BIT_KHR;instanceInfo.enabledExtensionCount=1;instanceInfo.ppEnabledExtensionNames=&portability;break;}free(extensions);
#else
 (void)portability;
#endif
 VkInstance instance;CHECK(vkCreateInstance(&instanceInfo,NULL,&instance));uint32_t count=1;VkPhysicalDevice physical;CHECK(vkEnumeratePhysicalDevices(instance,&count,&physical));
 VkPhysicalDeviceProperties props;vkGetPhysicalDeviceProperties(physical,&props);
 uint32_t familyCount=0;vkGetPhysicalDeviceQueueFamilyProperties(physical,&familyCount,NULL);if(familyCount>64)return 2;VkQueueFamilyProperties families[64];vkGetPhysicalDeviceQueueFamilyProperties(physical,&familyCount,families);uint32_t family=0;while(family<familyCount&&!(families[family].queueFlags&VK_QUEUE_COMPUTE_BIT))family++;if(family==familyCount)return 2;
 float priority=1;VkDeviceQueueCreateInfo qi={.sType=VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,.queueFamilyIndex=family,.queueCount=1,.pQueuePriorities=&priority};VkDeviceCreateInfo di={.sType=VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,.queueCreateInfoCount=1,.pQueueCreateInfos=&qi};VkDevice device;CHECK(vkCreateDevice(physical,&di,NULL,&device));VkQueue queue;vkGetDeviceQueue(device,family,0,&queue);
 VkPhysicalDeviceMemoryProperties mp;vkGetPhysicalDeviceMemoryProperties(physical,&mp);VkBuffer buffers[3];VkDeviceMemory memories[3];void *mapped[3];
 for(int i=0;i<3;i++){
  VkBufferCreateInfo bi={.sType=VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO,.size=sizes[i],.usage=VK_BUFFER_USAGE_STORAGE_BUFFER_BIT};CHECK(vkCreateBuffer(device,&bi,NULL,&buffers[i]));VkMemoryRequirements req;vkGetBufferMemoryRequirements(device,buffers[i],&req);uint32_t type=0;while(type<mp.memoryTypeCount&&(!(req.memoryTypeBits&(1u<<type))||(mp.memoryTypes[type].propertyFlags&6)!=6))type++;if(type==mp.memoryTypeCount)return 2;
  VkMemoryAllocateInfo ai={.sType=VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,.allocationSize=req.size,.memoryTypeIndex=type};CHECK(vkAllocateMemory(device,&ai,NULL,&memories[i]));CHECK(vkBindBufferMemory(device,buffers[i],memories[i],0));CHECK(vkMapMemory(device,memories[i],0,req.size,0,&mapped[i]));memset(mapped[i],0,sizes[i]);
 }
 memcpy(mapped[0],input,inputSize);free(input);
 VkDescriptorSetLayoutBinding bindings[3];memset(bindings,0,sizeof(bindings));for(int i=0;i<3;i++)bindings[i]=(VkDescriptorSetLayoutBinding){.binding=i,.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,.descriptorCount=1,.stageFlags=VK_SHADER_STAGE_COMPUTE_BIT};
 VkDescriptorSetLayoutCreateInfo sl={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO,.bindingCount=3,.pBindings=bindings};VkDescriptorSetLayout setLayout;CHECK(vkCreateDescriptorSetLayout(device,&sl,NULL,&setLayout));
 VkPipelineLayoutCreateInfo li={.sType=VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO,.setLayoutCount=1,.pSetLayouts=&setLayout};VkPipelineLayout layout;CHECK(vkCreatePipelineLayout(device,&li,NULL,&layout));VkDescriptorPoolSize ps={VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,3};VkDescriptorPoolCreateInfo pi={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO,.maxSets=1,.poolSizeCount=1,.pPoolSizes=&ps};VkDescriptorPool pool;CHECK(vkCreateDescriptorPool(device,&pi,NULL,&pool));VkDescriptorSetAllocateInfo sa={.sType=VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO,.descriptorPool=pool,.descriptorSetCount=1,.pSetLayouts=&setLayout};VkDescriptorSet set;CHECK(vkAllocateDescriptorSets(device,&sa,&set));
 for(int i=0;i<3;i++){VkDescriptorBufferInfo info={buffers[i],0,sizes[i]};VkWriteDescriptorSet w={.sType=VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET,.dstSet=set,.dstBinding=i,.descriptorCount=1,.descriptorType=VK_DESCRIPTOR_TYPE_STORAGE_BUFFER,.pBufferInfo=&info};vkUpdateDescriptorSets(device,1,&w,0,NULL);}
 VkShaderModule modules[2];VkPipeline pipelines[2];for(int i=0;i<2;i++){size_t size;uint32_t *code=readFile(argv[1+i],&size);VkShaderModuleCreateInfo sm={.sType=VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO,.codeSize=size,.pCode=code};CHECK(vkCreateShaderModule(device,&sm,NULL,&modules[i]));free(code);VkComputePipelineCreateInfo cp={.sType=VK_STRUCTURE_TYPE_COMPUTE_PIPELINE_CREATE_INFO,.stage={.sType=VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO,.stage=VK_SHADER_STAGE_COMPUTE_BIT,.module=modules[i],.pName="main"},.layout=layout};CHECK(vkCreateComputePipelines(device,0,1,&cp,NULL,&pipelines[i]));}
 VkCommandPoolCreateInfo pc={.sType=VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO,.queueFamilyIndex=family};VkCommandPool commandPool;CHECK(vkCreateCommandPool(device,&pc,NULL,&commandPool));VkCommandBufferAllocateInfo ca={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO,.commandPool=commandPool,.level=VK_COMMAND_BUFFER_LEVEL_PRIMARY,.commandBufferCount=1};VkCommandBuffer command;CHECK(vkAllocateCommandBuffers(device,&ca,&command));VkCommandBufferBeginInfo begin={.sType=VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};CHECK(vkBeginCommandBuffer(command,&begin));
 VkMemoryBarrier barrier={.sType=VK_STRUCTURE_TYPE_MEMORY_BARRIER,.srcAccessMask=VK_ACCESS_HOST_WRITE_BIT,.dstAccessMask=VK_ACCESS_SHADER_READ_BIT|VK_ACCESS_SHADER_WRITE_BIT};vkCmdPipelineBarrier(command,VK_PIPELINE_STAGE_HOST_BIT,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,0,1,&barrier,0,NULL,0,NULL);
 vkCmdBindDescriptorSets(command,VK_PIPELINE_BIND_POINT_COMPUTE,layout,0,1,&set,0,NULL);vkCmdBindPipeline(command,VK_PIPELINE_BIND_POINT_COMPUTE,pipelines[0]);vkCmdDispatch(command,(cols*rows+63)/64,1,1);
 barrier.srcAccessMask=VK_ACCESS_SHADER_WRITE_BIT;barrier.dstAccessMask=VK_ACCESS_SHADER_READ_BIT;vkCmdPipelineBarrier(command,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,0,1,&barrier,0,NULL,0,NULL);
 vkCmdBindPipeline(command,VK_PIPELINE_BIND_POINT_COMPUTE,pipelines[1]);vkCmdDispatch(command,(width+7)/8,(height+7)/8,1);
 barrier.dstAccessMask=VK_ACCESS_HOST_READ_BIT;vkCmdPipelineBarrier(command,VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,VK_PIPELINE_STAGE_HOST_BIT,0,1,&barrier,0,NULL,0,NULL);CHECK(vkEndCommandBuffer(command));
 VkFenceCreateInfo fi={.sType=VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};VkFence fence;CHECK(vkCreateFence(device,&fi,NULL,&fence));VkSubmitInfo submit={.sType=VK_STRUCTURE_TYPE_SUBMIT_INFO,.commandBufferCount=1,.pCommandBuffers=&command};CHECK(vkQueueSubmit(queue,1,&submit,fence));CHECK(vkWaitForFences(device,1,&fence,VK_TRUE,10000000000ull));if(((uint32_t*)mapped[2])[input[12]]){fprintf(stderr,"GPU tile overflow\n");return 1;}
 for(int i=1;i<3;i++){FILE *out=fopen(argv[3+i],"wb");if(!out||fwrite(mapped[i],1,sizes[i],out)!=sizes[i])return 2;fclose(out);}
 vkDestroyFence(device,fence,NULL);vkDestroyCommandPool(device,commandPool,NULL);for(int i=0;i<2;i++){vkDestroyPipeline(device,pipelines[i],NULL);vkDestroyShaderModule(device,modules[i],NULL);}vkDestroyDescriptorPool(device,pool,NULL);vkDestroyPipelineLayout(device,layout,NULL);vkDestroyDescriptorSetLayout(device,setLayout,NULL);for(int i=0;i<3;i++){vkUnmapMemory(device,memories[i]);vkDestroyBuffer(device,buffers[i],NULL);vkFreeMemory(device,memories[i],NULL);}vkDestroyDevice(device,NULL);vkDestroyInstance(instance,NULL);printf("NANOVG_VULKAN_HOST_COMPLETE %s %ux%u\n",props.deviceName,width,height);return 0;
}
